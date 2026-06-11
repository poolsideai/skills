.PHONY: test
test:
	go test ./... -coverprofile=coverage.out -covermode=atomic

.PHONY: build
build:
	mkdir -p bin
	go build -o bin/api-server ./cmd/api-server
	go build -o bin/worker ./cmd/worker
	go build -o bin/migrate ./cmd/migrate

.PHONY: clean
clean:
	rm -rf bin coverage.out
