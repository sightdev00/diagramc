import ssl

from archviz.web_server import _connection_error


def test_explains_https_to_plain_http_protocol_mismatch():
    error = _connection_error(
        ssl.SSLError("[SSL: WRONG_VERSION_NUMBER] wrong version number"),
        "https://127.0.0.1:8080/v1/chat/completions",
    )

    message = str(error)
    assert "HTTPS/HTTP" in message
    assert "http://127.0.0.1:8080/v1" in message
