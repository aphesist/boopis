package sample

import "fmt"

// Server serves requests.
type Server struct {
	Addr string
}

type Handler interface {
	Serve(path string) error
}

type ID int

type (
	Left  struct{}
	Right struct{}
)

// NewServer builds a server.
func NewServer(addr string) *Server {
	return &Server{Addr: addr}
}

// Start begins serving.
func (s *Server) Start() error {
	fmt.Println("listening on", s.Addr)
	return nil
}

func helper(a, b int) int {
	return a + b
}
