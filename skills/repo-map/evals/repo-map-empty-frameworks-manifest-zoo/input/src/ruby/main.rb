#!/usr/bin/env ruby
# Ruby hello world demonstration.

def greet(name)
  "Hello from Ruby, #{name}!"
end

if __FILE__ == $PROGRAM_NAME
  puts greet('world')
end
