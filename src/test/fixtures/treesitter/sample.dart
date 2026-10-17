class Greeter {
  final String name;

  Greeter(this.name);

  String hello() {
    return 'Hello, $name';
  }
}

void main() {
  final g = Greeter('World');
  print(g.hello());
}
