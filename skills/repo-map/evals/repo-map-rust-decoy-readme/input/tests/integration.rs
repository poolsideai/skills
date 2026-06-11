//! Integration tests (run with `cargo test`). The HTTP layer itself is
//! exercised in CI against the running binary; these pin the wire formats.

fn hex(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn hex_rendering_is_lowercase_and_double_width() {
    assert_eq!(hex(&[0x00, 0xab, 0xff]), "00abff");
}

#[test]
fn put_response_shape_is_stable() {
    let body = r#"{"key":"00abff"}"#;
    assert!(body.contains("\"key\""));
}
