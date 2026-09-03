# Verify the 3-4-5 worked example used in segment n2a.
a, b, c = 3, 4, 5
assert a**2 + b**2 == c**2, "3-4-5 is not a Pythagorean triple?!"
print(f"{a}^2 + {b}^2 = {a**2} + {b**2} = {a**2 + b**2} = {c}^2  OK")
