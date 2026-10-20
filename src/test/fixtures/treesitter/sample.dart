abstract class Widget {
  const Widget();
  Widget build();
}

class HelloText extends Widget {
  const HelloText(this.message);

  final String message;

  @override
  Widget build() {
    return this;
  }
}

void main() {
  const w = HelloText('World');
  w.build();
}
