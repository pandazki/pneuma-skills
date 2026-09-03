# Verify the rearrangement-proof geometry drawn in figure-proof.svg:
# outer square side a+b=7 (a=3, b=4); four congruent right triangles leave
# an inner quadrilateral with vertices P1..P4. Check every inner side has
# length c=5 and adjacent sides are perpendicular (so the hole is the c^2
# square the narration claims).
import math

a, b = 3, 4
c = math.hypot(a, b)
P = [(b, 0), (a + b, b), (a, a + b), (0, a)]  # (4,0),(7,4),(3,7),(0,3)

for i in range(4):
    x1, y1 = P[i]
    x2, y2 = P[(i + 1) % 4]
    side = math.hypot(x2 - x1, y2 - y1)
    assert abs(side - c) < 1e-12, f"side {i} has length {side}, expected {c}"
for i in range(4):
    x0, y0 = P[i - 1]
    x1, y1 = P[i]
    x2, y2 = P[(i + 1) % 4]
    dot = (x1 - x0) * (x2 - x1) + (y1 - y0) * (y2 - y1)
    assert dot == 0, f"corner {i} is not a right angle (dot={dot})"

print(f"inner quadrilateral: all sides = {c} (=c), all corners 90 degrees")
print(f"area check: (a+b)^2 - 4*(a*b/2) = {(a+b)**2 - 2*a*b} = c^2 = {int(c*c)}  OK")
