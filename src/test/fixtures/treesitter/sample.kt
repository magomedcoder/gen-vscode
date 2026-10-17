class Greeter(private val name: String) {
  fun hello(): String = "Hello, $name"
}

fun main() {
  val g = Greeter("World")
  println(g.hello())
}
