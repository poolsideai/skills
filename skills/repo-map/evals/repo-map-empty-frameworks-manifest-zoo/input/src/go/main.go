package main

import "fmt"

func greet(name string) string {
	return fmt.Sprintf("Hello from Go, %s!", name)
}

func main() {
	fmt.Println(greet("world"))
}
