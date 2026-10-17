struct Greeter {
  let name: String

  func hello() -> String {
    return "Hello, \(name)"
  }
}

func main() {
  let g = Greeter(name: "World")
  print(g.hello())
}
