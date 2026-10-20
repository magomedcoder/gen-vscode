data class User(val id: Long, val name: String)

class Greeter(private val name: String) {
  val greeting: String = "Hello"

  companion object {
    const val TAG = "Greeter"
  }

  fun hello(): String = "Hello, $name"
}

fun main() {
  val g = Greeter("World")
  println(g.hello())
}
