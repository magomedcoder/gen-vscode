CREATE TABLE users (
  id INT PRIMARY KEY,
  name TEXT
);

CREATE FUNCTION greet(n TEXT) RETURNS TEXT AS $$
  SELECT 'hello ' || n;
$$ LANGUAGE sql;
