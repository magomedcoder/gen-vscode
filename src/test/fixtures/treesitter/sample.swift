struct Point {
  var x: Double
  var y: Double

  func distance() -> Double {
    return (x * x + y * y).squareRoot()
  }
}

protocol GreeterProtocol {
  func hello() -> String
}

class Greeter: GreeterProtocol {
  let name: String

  init(name: String) {
    self.name = name
  }

  func hello() -> String {
    return "Hello, \(name)"
  }
}

func main() {
  let g = Greeter(name: "World")
  print(g.hello())
}
