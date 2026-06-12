package cache

// Node represents a node in the doubly-linked list.
type Node struct {
	key  string
	prev *Node
	next *Node
}

// LRU implements a least-recently-used eviction policy.
type LRU struct {
	head  *Node
	tail  *Node
	nodes map[string]*Node
}

// NewLRU creates a new LRU tracker.
func NewLRU() *LRU {
	head := &Node{}
	tail := &Node{}
	head.next = tail
	tail.prev = head
	return &LRU{
		head:  head,
		tail:  tail,
		nodes: make(map[string]*Node),
	}
}

// Add adds a key to the front of the LRU list (most recently used).
func (l *LRU) Add(key string) {
	if node, exists := l.nodes[key]; exists {
		l.remove(node)
	}
	node := &Node{key: key}
	l.addToFront(node)
	l.nodes[key] = node
}

// Access marks a key as recently used by moving it to the front.
func (l *LRU) Access(key string) {
	if node, exists := l.nodes[key]; exists {
		l.remove(node)
		l.addToFront(node)
	}
}

// Remove removes a key from the LRU list.
func (l *LRU) Remove(key string) {
	if node, exists := l.nodes[key]; exists {
		l.remove(node)
		delete(l.nodes, key)
	}
}

// Evict removes and returns the least recently used key.
func (l *LRU) Evict() string {
	if l.tail.prev == l.head {
		return ""
	}
	node := l.tail.prev
	l.remove(node)
	delete(l.nodes, node.key)
	return node.key
}

// addToFront adds a node right after the head (most recently used position).
func (l *LRU) addToFront(node *Node) {
	node.next = l.head.next
	node.prev = l.head
	l.head.next.prev = node
	l.head.next = node
}

// remove removes a node from its current position in the list.
func (l *LRU) remove(node *Node) {
	node.prev.next = node.next
	node.next.prev = node.prev
}
