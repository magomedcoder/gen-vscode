class Greeter
  def hello(name)
    "привет #{name}"
  end
end

def main
  puts Greeter.new.hello("мир")
end
