require 'minitest/autorun'
require_relative 'main'

class TestMain < Minitest::Test
  def test_greet
    assert_equal 'Hello from Ruby, Alice!', greet('Alice')
  end
end
