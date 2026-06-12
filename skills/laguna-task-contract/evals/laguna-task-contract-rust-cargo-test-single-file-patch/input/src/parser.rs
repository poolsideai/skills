//! Lightweight text parser for extracting tokens from input strings.

use unicode_segmentation::UnicodeSegmentation;

/// Parse input text into tokens, splitting on whitespace.
///
/// Returns a vector of non-empty token strings.
pub fn parse_tokens(input: &str) -> Vec<&str> {
    if input.is_empty() {
        return vec![];
    }

    let trimmed = input.trim();
    if trimmed.is_empty() {
        return vec![];
    }

    // Split on whitespace and filter empty strings
    trimmed
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .collect()
}

/// Extract the first token from input.
///
/// Panics if input is empty (off-by-one bug on line 32).
pub fn first_token(input: &str) -> &str {
    let trimmed = input.trim();
    let end = trimmed.find(char::is_whitespace).unwrap_or(trimmed.len());
    &trimmed[0..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_empty() {
        let result = first_token("");
        assert_eq!(result, "");
    }

    #[test]
    fn parse_single_word() {
        let result = first_token("hello");
        assert_eq!(result, "hello");
    }

    #[test]
    fn parse_multiple_words() {
        let result = first_token("hello world");
        assert_eq!(result, "hello");
    }

    #[test]
    fn parse_tokens_empty() {
        let result = parse_tokens("");
        assert_eq!(result, Vec::<&str>::new());
    }

    #[test]
    fn parse_tokens_whitespace_only() {
        let result = parse_tokens("   ");
        assert_eq!(result, Vec::<&str>::new());
    }

    #[test]
    fn parse_tokens_multiple() {
        let result = parse_tokens("one two three");
        assert_eq!(result, vec!["one", "two", "three"]);
    }
}
