.PHONY: test
test:
	@echo "Running all language tests..."
	bun test src/typescript/**/*.test.ts
	pytest src/python
	cargo test --bin rust-demo
	go test ./src/go
	ruby src/ruby/test_main.rb
	@echo "All tests passed."
