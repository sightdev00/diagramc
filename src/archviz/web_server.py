from __future__ import annotations

import hmac
from collections import deque
import ipaddress
import json
import os
import secrets
import mimetypes
import re
import ssl
import socket
import threading
import time
import urllib.error
import urllib.request

import yaml
from dataclasses import dataclass, field
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Literal
from urllib.parse import parse_qs, urlparse

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .ai_normalizer import normalize_ai_transaction
from .v2.commands import Transaction, apply_transaction
from .v2.models import DiagramDocument


SYSTEM_PROMPT = """You are DiagramC's diagram planning engine.
Return one JSON object only. Do not use Markdown and never emit SVG or coordinates.
The object must be a DiagramC transaction with these fields:
transactionId, baseRevision, actor="ai", summary, operations.
Allowed operation types:
- element.create: {op, element}
- element.update: {op, elementId, dataPatch?, semanticType?, parentId?, clearParent?}
- element.delete: {op, elementId, cascade}
- relation.create: {op, relation}
- relation.delete: {op, relationId}
- layout.pin: {op, elementId, layoutName?, position}
- layout.unpin: {op, elementId, layoutName?}
- layout.apply: {op, layoutName?, engine?, profile?, direction?, optionsPatch?, scope?}
- presentation.applyTheme: {op, theme, target?, stylesPatch?}
Exact canonical examples:
- Create node: {"op":"element.create","element":{"id":"review","kind":"node","semanticType":"flow.step","data":{"label":"Review"}}}
- Create relation: {"op":"relation.create","relation":{"id":"a-to-b","kind":"directed","semanticType":"relation.main","source":{"elementId":"a"},"target":{"elementId":"b"},"data":{"label":"next"}}}
Labels and descriptions always belong inside data. Never use sourceId, targetId, or a top-level element label.
Operation order matters. Never reference an element or relation unless it exists in the current document or was created by an earlier operation. When deleting a group with cascade=true, do not also delete its child elements or incident relations.
Use a clear but varied visual vocabulary when it improves meaning:
- process/step: data.shape="rounded"
- decision/condition/gateway: data.shape="diamond"
- data/input/output/storage: data.shape="ellipse"
- service/component: data.shape="rectangle"
- annotation: kind="note" and data.shape="note"
Additional supported shapes when semantically useful: capsule, circle, hexagon, parallelogram, trapezoid, subprocess, database, document, and cloud.
Use group elements for meaningful phases, layers, lanes, or subsystems. Put optional description, fillColor, strokeColor, and textColor inside data. Do not vary shapes or colors decoratively; use them consistently by semantic role.
When the user explicitly requests a visual style, use presentation.applyTheme. Available editable canvas themes are presentation (polished SVG-style), engineering, paper, dark, sketch, and mermaid.
Use existing IDs when editing. Create stable ASCII IDs for new objects. Keep the operation set minimal.
"""


class ProviderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    kind: str
    baseUrl: str
    model: str
    apiKey: str | None = None


class AiCommandRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document: DiagramDocument
    prompt: str = Field(min_length=1, max_length=16_000)
    provider: ProviderRequest
    mode: Literal["replace", "modify"] = "modify"


class ReplayCommandRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document: DiagramDocument
    transaction: Dict[str, Any]
    mode: Literal["replace", "modify"] = "modify"


@dataclass(frozen=True)
class GatewayResponse:
    transaction: Transaction
    candidate: DiagramDocument
    diagnostics: list[dict[str, Any]]


DEFAULT_PROVIDER_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "api.openai.com"})


class RevisionConflict(ValueError):
    def __init__(self, expected: int, actual: int) -> None:
        super().__init__(
            f"shared Studio state changed (expected revision {expected}, current {actual})"
        )
        self.expected = expected
        self.actual = actual


@dataclass
class AccessController:
    """Keeps the active browser token mutable only when it has a secure token file."""

    token: str | None
    token_path: Path | None = None
    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False)

    @property
    def can_rotate(self) -> bool:
        return bool(self.token and self.token_path)

    def rotate(self) -> str:
        if not self.can_rotate or self.token_path is None:
            raise ValueError(
                "access token rotation is available only for automatically managed LAN tokens"
            )
        token = secrets.token_urlsafe(32)
        with self._lock:
            try:
                self.token_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                descriptor = os.open(self.token_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                    handle.write(f"{token}\n")
                self.token_path.chmod(0o600)
            except OSError as exc:
                raise ValueError(f"cannot rotate DiagramC access token: {exc}") from exc
            self.token = token
        return token


class ProviderEndpointPolicy:
    """Exact allowlist for model-provider hosts used by the local gateway."""

    def __init__(self, allowed_hosts: set[str] | frozenset[str] = DEFAULT_PROVIDER_HOSTS) -> None:
        self.allowed_hosts = frozenset(
            host.strip().lower() for host in allowed_hosts if host.strip()
        )

    def validate(self, base_url: str) -> str:
        parsed = urlparse(base_url)
        host = (parsed.hostname or "").lower()
        if host not in self.allowed_hosts:
            allowed = ", ".join(sorted(self.allowed_hosts))
            raise ValueError(
                f"provider host {host or base_url} is not allowed; allowed hosts: {allowed}"
            )
        if host == "api.openai.com" and parsed.scheme != "https":
            raise ValueError("api.openai.com requires an HTTPS baseUrl")
        return host


class SlidingWindowRateLimiter:
    def __init__(self, limit: int = 12, window_seconds: float = 60.0) -> None:
        self.limit = max(1, limit)
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def retry_after(self, client: str) -> int | None:
        now = time.monotonic()
        with self._lock:
            events = self._events.setdefault(client, deque())
            while events and now - events[0] >= self.window_seconds:
                events.popleft()
            if len(events) >= self.limit:
                return max(1, int(self.window_seconds - (now - events[0])) + 1)
            events.append(now)
        return None


class StudioStore:
    """Thread-safe, process-local coordinator for the shared Studio state file."""

    def __init__(self, path: Path) -> None:
        self.path = path.expanduser().resolve()
        self._lock = threading.RLock()

    @staticmethod
    def _empty_state() -> Dict[str, Any]:
        return {
            "schemaVersion": 1,
            "revision": 0,
            "updatedAt": None,
            "workspace": None,
            "commandHistory": [],
            "modelProfile": None,
            "auditLog": [],
        }

    @staticmethod
    def _shared_model_profile(value: Any) -> Dict[str, str]:
        if not isinstance(value, dict):
            raise ValueError("model profile must be an object")
        profile = {key: value.get(key) for key in ("id", "name", "kind", "baseUrl", "model")}
        if not all(isinstance(item, str) for item in profile.values()):
            raise ValueError("model profile id, name, kind, baseUrl, and model must be strings")
        if (
            not profile["id"].strip()
            or not profile["name"].strip()
            or not profile["baseUrl"].strip()
        ):
            raise ValueError("model profile id, name, and baseUrl cannot be empty")
        if profile["kind"] not in {"ollama", "openai-compatible", "openai"}:
            raise ValueError("model profile kind is not supported")
        if any(len(item) > 2048 for item in profile.values()):
            raise ValueError("model profile fields are too long")
        # Rebuild the object instead of retaining unknown fields. API keys must
        # never enter shared Studio storage.
        return profile

    def _read_unlocked(self) -> Dict[str, Any]:
        if not self.path.is_file():
            return self._empty_state()
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"cannot read shared Studio state: {exc}") from exc
        if not isinstance(value, dict):
            raise ValueError("shared Studio state must be a JSON object")

        state = self._empty_state()
        state["revision"] = max(0, int(value.get("revision", 0)))
        state["updatedAt"] = (
            value.get("updatedAt") if isinstance(value.get("updatedAt"), str) else None
        )
        workspace = value.get("workspace")
        if workspace is not None:
            state["workspace"] = DiagramDocument.model_validate(workspace).to_external_dict()
        history = value.get("commandHistory", [])
        if not isinstance(history, list) or not all(isinstance(record, dict) for record in history):
            raise ValueError("shared commandHistory must be an array of objects")
        state["commandHistory"] = history[-30:]
        profile = value.get("modelProfile")
        if profile is not None:
            state["modelProfile"] = self._shared_model_profile(profile)
        audit = value.get("auditLog", [])
        if not isinstance(audit, list) or not all(isinstance(record, dict) for record in audit):
            raise ValueError("shared auditLog must be an array of objects")
        state["auditLog"] = audit[-200:]
        return state

    def _write_unlocked(self, state: Dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f".{self.path.name}.tmp")
        try:
            temporary.write_text(
                f"{json.dumps(state, ensure_ascii=False, indent=2)}\n",
                encoding="utf-8",
            )
            temporary.replace(self.path)
        except OSError as exc:
            raise ValueError(f"cannot write shared Studio state: {exc}") from exc

    @staticmethod
    def _touch(state: Dict[str, Any]) -> None:
        state["revision"] = int(state.get("revision", 0)) + 1
        state["updatedAt"] = datetime.now(timezone.utc).isoformat()

    def read(self) -> Dict[str, Any]:
        with self._lock:
            return self._read_unlocked()

    @staticmethod
    def _check_revision(state: Dict[str, Any], expected_revision: Any) -> None:
        if expected_revision is None:
            return
        if not isinstance(expected_revision, int) or expected_revision < 0:
            raise ValueError("baseRevision must be a non-negative integer")
        actual = int(state.get("revision", 0))
        if expected_revision != actual:
            raise RevisionConflict(expected_revision, actual)

    def save_workspace(self, value: Any, *, expected_revision: int | None = None) -> Dict[str, Any]:
        document = DiagramDocument.model_validate(value).to_external_dict()
        with self._lock:
            state = self._read_unlocked()
            self._check_revision(state, expected_revision)
            state["workspace"] = document
            self._touch(state)
            self._write_unlocked(state)
            return state

    def save_command_history(
        self, value: Any, *, expected_revision: int | None = None
    ) -> Dict[str, Any]:
        if not isinstance(value, list) or not all(isinstance(record, dict) for record in value):
            raise ValueError("commandHistory must be an array of objects")
        with self._lock:
            state = self._read_unlocked()
            self._check_revision(state, expected_revision)
            state["commandHistory"] = value[-30:]
            self._touch(state)
            self._write_unlocked(state)
            return state

    def save_model_profile(
        self, value: Any, *, expected_revision: int | None = None
    ) -> Dict[str, Any]:
        profile = self._shared_model_profile(value)
        with self._lock:
            state = self._read_unlocked()
            self._check_revision(state, expected_revision)
            state["modelProfile"] = profile
            self._touch(state)
            self._write_unlocked(state)
            return state

    def record_audit(self, event: str, client: str, details: Dict[str, str] | None = None) -> None:
        if not event or len(event) > 120 or len(client) > 256:
            return
        safe_details = {
            key: value
            for key, value in (details or {}).items()
            if isinstance(key, str)
            and isinstance(value, str)
            and len(key) <= 80
            and len(value) <= 512
            and not any(
                secret in key.lower()
                for secret in ("key", "token", "prompt", "secret", "authorization")
            )
        }
        with self._lock:
            state = self._read_unlocked()
            audit = state["auditLog"]
            audit.append(
                {
                    "at": datetime.now(timezone.utc).isoformat(),
                    "event": event,
                    "client": client,
                    "details": safe_details,
                }
            )
            state["auditLog"] = audit[-200:]
            self._write_unlocked(state)

    def audit_log(self) -> list[Dict[str, Any]]:
        with self._lock:
            return list(self._read_unlocked()["auditLog"])


def _endpoint(base_url: str) -> str:
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("provider baseUrl must be an absolute http(s) URL")
    return f"{base_url.rstrip('/')}/chat/completions"


def _extract_json(content: str) -> Dict[str, Any]:
    text = content.strip()
    fenced = re.fullmatch(
        r"```(?:json|json5|yaml)?\s*(.*?)\s*```", text, flags=re.DOTALL | re.IGNORECASE
    )
    if fenced:
        text = fenced.group(1).strip()

    candidates = [text]
    root_pattern = re.compile(
        r"\{\s*['\"]?(?:transaction|transactionId|baseRevision|actor|summary|operations|commands)['\"]?\s*:",
        flags=re.IGNORECASE,
    )
    for match in root_pattern.finditer(text):
        end = text.rfind("}")
        if end > match.start():
            candidates.append(text[match.start() : end + 1])
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        candidates.append(text[start : end + 1])

    last_error: Exception | None = None
    for candidate in dict.fromkeys(candidates):
        for parser in (json.loads, yaml.safe_load):
            try:
                value = parser(candidate)
            except (json.JSONDecodeError, yaml.YAMLError, ValueError) as exc:
                last_error = exc
                continue
            if not isinstance(value, dict):
                continue
            if isinstance(value.get("transaction"), dict):
                value = value["transaction"]
            if isinstance(value, dict) and set(value).intersection(
                {"transactionId", "baseRevision", "actor", "summary", "operations", "commands"}
            ):
                return value

    preview = " ".join(text[:180].splitlines())
    raise ValueError(
        f"model response does not contain a parseable JSON object; preview={preview!r}"
    ) from last_error


def _message_content(response: Dict[str, Any]) -> str:
    try:
        content = response["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("provider response is missing choices[0].message.content") from exc
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [item.get("text", "") for item in content if isinstance(item, dict)]
        return "".join(parts)
    raise ValueError("provider returned an unsupported message content type")


def _connection_error(reason: Any, url: str) -> ValueError:
    message = str(reason)
    parsed = urlparse(url)
    if "WRONG_VERSION_NUMBER" in message.upper() and parsed.scheme == "https":
        plain_base = request_base = url.replace("https://", "http://", 1)
        if request_base.endswith("/chat/completions"):
            plain_base = request_base[: -len("/chat/completions")]
        return ValueError(
            "Provider HTTPS/HTTP 协议不匹配：当前地址使用 https://，但目标服务看起来只提供普通 HTTP。"
            f"请将服务地址改为 {plain_base}"
        )
    if "CERTIFICATE_VERIFY_FAILED" in message.upper():
        return ValueError(
            "Provider TLS 证书校验失败。请检查证书链或改用受信任证书；不要在公网连接上关闭证书校验。"
        )
    return ValueError(f"cannot connect to provider: {reason}")


def _command_base_document(request: AiCommandRequest) -> DiagramDocument:
    if request.mode == "modify":
        return request.document
    base = request.document.model_copy(deep=True)
    base.elements = []
    base.relations = []
    base.constraints = []
    for layout in base.layouts.values():
        layout.overrides = {}
    return base


def _replay_base_document(request: ReplayCommandRequest) -> DiagramDocument:
    if request.mode == "modify":
        return request.document
    base = request.document.model_copy(deep=True)
    base.elements = []
    base.relations = []
    base.constraints = []
    for layout in base.layouts.values():
        layout.overrides = {}
    return base


def _make_replay_idempotent(
    transaction_data: Dict[str, Any],
    document: DiagramDocument,
) -> tuple[Dict[str, Any], list[str]]:
    """Make stored create operations safe to replay against an evolved document."""
    data = dict(transaction_data)
    element_ids = {element.id for element in document.elements}
    relation_ids = {relation.id for relation in document.relations}
    operations: list[Dict[str, Any]] = []
    fixes: list[str] = []

    for index, raw_operation in enumerate(data.get("operations", [])):
        operation = dict(raw_operation)
        op = operation.get("op")
        if op == "element.create":
            element = operation.get("element")
            element_id = element.get("id") if isinstance(element, dict) else None
            if isinstance(element_id, str) and element_id in element_ids:
                replacement: Dict[str, Any] = {
                    "op": "element.update",
                    "elementId": element_id,
                    "dataPatch": dict(element.get("data") or {}),
                    "semanticType": element.get("semanticType"),
                }
                if element.get("parentId") is not None:
                    replacement["parentId"] = element["parentId"]
                else:
                    replacement["clearParent"] = True
                operations.append(replacement)
                fixes.append(
                    f"operation {index}: replayed existing element '{element_id}' as update"
                )
                continue
            if isinstance(element_id, str):
                element_ids.add(element_id)
        elif op == "relation.create":
            relation = operation.get("relation")
            relation_id = relation.get("id") if isinstance(relation, dict) else None
            if isinstance(relation_id, str) and relation_id in relation_ids:
                operations.append({"op": "relation.delete", "relationId": relation_id})
                fixes.append(f"operation {index}: replaced existing relation '{relation_id}'")
            if isinstance(relation_id, str):
                relation_ids.add(relation_id)
        elif op == "element.delete":
            element_id = operation.get("elementId")
            if isinstance(element_id, str):
                element_ids.discard(element_id)
        elif op == "relation.delete":
            relation_id = operation.get("relationId")
            if isinstance(relation_id, str):
                relation_ids.discard(relation_id)
        operations.append(operation)

    data["operations"] = operations
    return data, fixes


def replay_commands(request: ReplayCommandRequest) -> GatewayResponse:
    base_document = _replay_base_document(request)
    transaction_data, normalizations = normalize_ai_transaction(
        request.transaction,
        base_document.document.diagram_type,
        base_document,
    )
    if request.mode == "modify":
        transaction_data, replay_fixes = _make_replay_idempotent(transaction_data, base_document)
        normalizations.extend(replay_fixes)
    transaction_data["baseRevision"] = base_document.document.revision
    transaction_data["actor"] = "ai"
    transaction_data["transactionId"] = (
        f"{transaction_data.get('transactionId', 'history')}-replay-r{base_document.document.revision}"
    )
    transaction = Transaction.model_validate(transaction_data)
    result = apply_transaction(base_document, transaction)
    diagnostics = [
        {"level": "warning", "code": "history-replay-normalized", "message": message}
        for message in normalizations
    ]
    return GatewayResponse(
        transaction=transaction,
        candidate=result.document,
        diagnostics=[*diagnostics, *result.diagnostics],
    )


def generate_commands(
    request: AiCommandRequest,
    *,
    timeout: float = 600.0,
    provider_policy: ProviderEndpointPolicy | None = None,
) -> GatewayResponse:
    if provider_policy:
        provider_policy.validate(request.provider.baseUrl)
    url = _endpoint(request.provider.baseUrl)
    base_document = _command_base_document(request)
    current = base_document.to_external_dict()
    user_prompt = (
        f"Generation mode: {request.mode}. "
        f"When mode is replace, create a complete new diagram from the empty structural document; "
        f"when mode is modify, change the existing diagram minimally.\n"
        f"User intent:\n{request.prompt}\n\n"
        f"Current DiagramC document (revision {base_document.document.revision}):\n"
        f"{json.dumps(current, ensure_ascii=False, separators=(',', ':'))}"
    )
    payload = {
        "model": request.provider.model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.2,
    }
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if request.provider.apiKey:
        headers["Authorization"] = f"Bearer {request.provider.apiKey}"
    http_request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(http_request, timeout=timeout) as response:
            provider_response = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read(2048).decode("utf-8", errors="replace")
        raise ValueError(f"provider returned HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise _connection_error(exc.reason, url) from exc
    except ssl.SSLError as exc:
        raise _connection_error(exc, url) from exc

    transaction_data = _extract_json(_message_content(provider_response))
    transaction_data, normalizations = normalize_ai_transaction(
        transaction_data,
        base_document.document.diagram_type,
        base_document,
    )
    transaction_data.setdefault("actor", "ai")
    transaction_data.setdefault("baseRevision", base_document.document.revision)
    transaction_data.setdefault("transactionId", f"ai-r{base_document.document.revision + 1}")
    try:
        transaction = Transaction.model_validate(transaction_data)
    except ValidationError as exc:
        issues = exc.errors(include_url=False)
        preview = "; ".join(
            f"{'.'.join(str(part) for part in issue['loc'])}: {issue['msg']}"
            for issue in issues[:8]
        )
        remaining = f"; plus {len(issues) - 8} more" if len(issues) > 8 else ""
        raise ValueError(
            f"AI commands are still invalid after automatic normalization ({len(issues)} issues): "
            f"{preview}{remaining}"
        ) from exc
    result = apply_transaction(base_document, transaction)
    normalization_diagnostics = [
        {"level": "warning", "code": "ai-output-normalized", "message": message}
        for message in normalizations
    ]
    return GatewayResponse(
        transaction=transaction,
        candidate=result.document,
        diagnostics=[*normalization_diagnostics, *result.diagnostics],
    )


def _repo_web_root() -> Path:
    return Path(__file__).resolve().parents[2] / "apps" / "web" / "dist"


def _is_loopback_host(host: str) -> bool:
    """Return whether *host* only accepts connections from this machine."""
    normalized = host.strip().strip("[]").lower()
    if normalized == "localhost":
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def _lan_ipv4_addresses() -> list[str]:
    """Best-effort local IPv4 addresses for a helpful LAN access URL."""
    addresses: set[str] = set()
    try:
        addresses.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            addresses.add(probe.getsockname()[0])
    except OSError:
        pass
    return sorted(
        address
        for address in addresses
        if not ipaddress.ip_address(address).is_loopback
        and not ipaddress.ip_address(address).is_unspecified
    )


def access_token_for_host(
    host: str,
    explicit_token: str | None = None,
    token_path: Path | None = None,
) -> str | None:
    """Resolve a browser token, creating a durable one for network listeners."""
    if explicit_token:
        return explicit_token
    if _is_loopback_host(host):
        return None

    path = (token_path or Path.home() / ".diagramc" / "access-token").expanduser()
    try:
        if path.is_file():
            saved_token = path.read_text(encoding="utf-8").strip()
            if saved_token:
                return saved_token

        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        generated_token = secrets.token_urlsafe(32)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(f"{generated_token}\n")
        try:
            path.chmod(0o600)
        except OSError:
            pass
        return generated_token
    except OSError as exc:
        raise RuntimeError(f"cannot create DiagramC access token at {path}: {exc}") from exc


def make_handler(
    web_root: Path,
    store: StudioStore | None = None,
    access_token: str | AccessController | None = None,
    provider_policy: ProviderEndpointPolicy | None = None,
    rate_limiter: SlidingWindowRateLimiter | None = None,
):
    studio_store = store or StudioStore(Path.home() / ".diagramc" / "studio-state.json")
    access = (
        access_token
        if isinstance(access_token, AccessController)
        else AccessController(access_token)
    )
    policy = provider_policy or ProviderEndpointPolicy()
    limiter = rate_limiter or SlidingWindowRateLimiter()

    class DiagramCHandler(SimpleHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self._grant_access_cookie = False
            super().__init__(*args, directory=str(web_root), **kwargs)

        def _authorized(self) -> bool:
            if not access.token:
                return True
            query = parse_qs(urlparse(self.path).query)
            supplied = query.get("token", [""])[0]
            if supplied and hmac.compare_digest(supplied, access.token):
                self._grant_access_cookie = True
                return True
            for cookie in self.headers.get("Cookie", "").split(";"):
                name, _, value = cookie.strip().partition("=")
                if name == "diagramc_token" and hmac.compare_digest(value, access.token):
                    return True
            return False

        def end_headers(self) -> None:
            if self._grant_access_cookie and access.token:
                self.send_header(
                    "Set-Cookie",
                    "diagramc_token=" + access.token + "; HttpOnly; SameSite=Strict; Path=/",
                )
            if not self.path.startswith("/api/"):
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
            super().end_headers()

        def _send_json(
            self,
            status: int,
            value: Dict[str, Any],
            headers: dict[str, str] | None = None,
        ) -> None:
            payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            for name, header_value in (headers or {}).items():
                self.send_header(name, header_value)
            self.end_headers()
            self.wfile.write(payload)

        def _read_json(self, *, max_bytes: int = 4 * 1024 * 1024) -> Any:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > max_bytes:
                raise ValueError(
                    f"request body must be between 1 byte and {max_bytes // (1024 * 1024)} MiB"
                )
            return json.loads(self.rfile.read(length).decode("utf-8"))

        def do_GET(self) -> None:
            if not self._authorized():
                self._send_json(
                    HTTPStatus.FORBIDDEN, {"error": "valid DiagramC access token required"}
                )
                return
            path = urlparse(self.path).path
            if path == "/api/health":
                self._send_json(HTTPStatus.OK, {"status": "ok", "service": "diagramc-gateway"})
                return
            if path == "/api/studio/state":
                try:
                    self._send_json(HTTPStatus.OK, studio_store.read())
                except Exception as exc:
                    print(f"[DiagramC Studio Store] {type(exc).__name__}: {exc}", flush=True)
                    self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
                return
            if path == "/api/studio/audit":
                self._send_json(HTTPStatus.OK, {"records": studio_store.audit_log()})
                return
            if path.startswith("/api/"):
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "API route not found"})
                return
            path = self.path.split("?", 1)[0]
            candidate = (web_root / path.lstrip("/")).resolve()
            if path != "/" and candidate.is_file() and web_root.resolve() in candidate.parents:
                super().do_GET()
                return
            self.path = "/index.html"
            super().do_GET()

        def do_POST(self) -> None:
            if not self._authorized():
                self._send_json(
                    HTTPStatus.FORBIDDEN, {"error": "valid DiagramC access token required"}
                )
                return
            path = urlparse(self.path).path
            client = self.client_address[0]
            if path == "/api/security/access-token/rotate":
                try:
                    token = access.rotate()
                    studio_store.record_audit("access-token.rotated", client)
                    self._grant_access_cookie = True
                    self._send_json(HTTPStatus.OK, {"token": token})
                except ValueError as exc:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return
            if path not in {"/api/ai/commands", "/api/commands/replay"}:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "API route not found"})
                return
            try:
                data = self._read_json()
                if path == "/api/ai/commands":
                    retry_after = limiter.retry_after(client)
                    if retry_after is not None:
                        studio_store.record_audit("provider.rate-limited", client)
                        self._send_json(
                            HTTPStatus.TOO_MANY_REQUESTS,
                            {"error": "AI request rate limit reached; try again shortly"},
                            {"Retry-After": str(retry_after)},
                        )
                        return
                    request = AiCommandRequest.model_validate(data)
                    host = policy.validate(request.provider.baseUrl)
                    result = generate_commands(request, provider_policy=policy)
                    studio_store.record_audit(
                        "provider.request.succeeded",
                        client,
                        {"host": host, "mode": request.mode},
                    )
                else:
                    result = replay_commands(ReplayCommandRequest.model_validate(data))
                transaction = result.transaction.model_dump(
                    mode="json", by_alias=True, exclude_none=True
                )
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "transaction": transaction,
                        "summary": result.transaction.summary,
                        "operations": transaction["operations"],
                        "document": result.candidate.to_external_dict(),
                        "diagnostics": result.diagnostics,
                    },
                )
            except Exception as exc:  # API boundary: convert validation/provider failures to JSON.
                if path == "/api/ai/commands":
                    studio_store.record_audit(
                        "provider.request.failed", client, {"error": type(exc).__name__}
                    )
                print(f"[DiagramC Gateway] {type(exc).__name__}: {exc}", flush=True)
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

        def do_PUT(self) -> None:
            if not self._authorized():
                self._send_json(
                    HTTPStatus.FORBIDDEN, {"error": "valid DiagramC access token required"}
                )
                return
            if self.path not in {
                "/api/studio/workspace",
                "/api/studio/history",
                "/api/studio/model-profile",
            }:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "API route not found"})
                return
            try:
                data = self._read_json(max_bytes=32 * 1024 * 1024)
                if not isinstance(data, dict):
                    raise ValueError("request body must be a JSON object")
                if self.path == "/api/studio/workspace":
                    state = studio_store.save_workspace(
                        data.get("document"), expected_revision=data.get("baseRevision")
                    )
                elif self.path == "/api/studio/history":
                    state = studio_store.save_command_history(
                        data.get("records"), expected_revision=data.get("baseRevision")
                    )
                else:
                    state = studio_store.save_model_profile(
                        data.get("profile"), expected_revision=data.get("baseRevision")
                    )
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "status": "saved",
                        "revision": state["revision"],
                        "updatedAt": state["updatedAt"],
                    },
                )
            except RevisionConflict as exc:
                self._send_json(
                    HTTPStatus.CONFLICT,
                    {"error": str(exc), "revision": exc.actual},
                )
            except Exception as exc:
                print(f"[DiagramC Studio Store] {type(exc).__name__}: {exc}", flush=True)
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    return DiagramCHandler


def serve(
    host: str = "127.0.0.1",
    port: int = 8765,
    web_root: Path | None = None,
    state_file: Path | None = None,
    access_token: str | None = None,
    allowed_provider_hosts: set[str] | None = None,
    ai_rate_limit: int = 12,
) -> None:
    root = (web_root or _repo_web_root()).resolve()
    if not (root / "index.html").is_file():
        raise FileNotFoundError(f"web build not found at {root}; run 'pnpm build' first")
    mimetypes.add_type("application/javascript", ".js")
    store = StudioStore(state_file or Path.home() / ".diagramc" / "studio-state.json")
    token_path = (
        None
        if access_token or _is_loopback_host(host)
        else Path.home() / ".diagramc" / "access-token"
    )
    resolved_token = access_token_for_host(host, access_token, token_path)
    access = AccessController(resolved_token, token_path)
    server = ThreadingHTTPServer(
        (host, port),
        make_handler(
            root,
            store,
            access,
            ProviderEndpointPolicy(allowed_provider_hosts or DEFAULT_PROVIDER_HOSTS),
            SlidingWindowRateLimiter(ai_rate_limit),
        ),
    )
    print(
        f"DiagramC Studio: http://{host}:{port}"
        + (f"/?token={resolved_token}" if resolved_token else "")
    )
    if resolved_token and not access_token:
        print("A persistent access token was generated for this network listener.")
    if host.strip() in {"0.0.0.0", "::", "[::]"}:
        for lan_address in _lan_ipv4_addresses():
            print(
                f"DiagramC Studio (LAN): http://{lan_address}:{port}"
                + (f"/?token={resolved_token}" if resolved_token else "")
            )
    print(f"Shared Studio state: {store.path}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
