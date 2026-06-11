//! Rust hello world demonstration.

fn greet(name: &str) -> String {
    format!("Hello from Rust, {}!", name)
}

fn main() {
    println!("{}", greet("world"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_greet() {
        assert_eq!(greet("Alice"), "Hello from Rust, Alice!");
    }
}
