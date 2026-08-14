@board 4

# Why more machines do not always mean more speed

This board has one thing to settle: parallel work has a ceiling, and the ceiling sits far lower than most people assume.

## Put the saying on the board first

If it is slow, add machines. At small scale that is almost always true, which is why so few people ever ask when it stops being true.

Write the machine count as $n$ and the throughput of one machine as $T_1$. The saying claims the total is $n T_1$: ==twice the machines, twice the speed==.

## First cut: some of the work refuses to share

@turn

Open up any job and there are only two kinds of work inside: work that can be handed out to more machines, and work that has to be done in order no matter how many machines turn up.

- Parallel work: the more machines, the thinner each slice
- Serial work: unmoved by any machine count
- The ceiling: set by the second kind alone

Call the parallel fraction $p$. Amdahl's law writes the speed-up like this:

$$S(n) = \frac{1}{(1 - p) + \frac{p}{n}}$$

Two numbers are enough to be alarming: at $p = 0.95$ an unlimited pile of machines buys you ((20×)), no more; even at $p = 0.99$ the ceiling is ((100×)).

## Second cut: the machines also talk to each other

@turn

Amdahl is the optimistic reading. It assumes the parallel work never gets in its own way, and real systems are not like that: the more machines there are, the more of the day goes into agreeing with each other.

The universal scalability law puts the price of that talking into the denominator:

$$C(n) = \frac{n}{1 + \alpha(n - 1) + \beta n(n - 1)}$$

Here $\alpha$ is contention — everyone queueing for the same resource; $\beta$ is coherence — every machine keeping every other machine up to date. **Contention flattens the curve. Coherence bends it back down.**

## Both curves on the same axes

@turn

```chart Speed-up
x: 1 2 4 8 16 32 64  (machines)
y: 0 .. 20  (×)
```

The serial-fraction curve first. It never stops climbing; it just climbs worse and worse:

```chart Speed-up
+ Serial fraction only: 1 1.9 3.5 5.9 9.1 12.6 15.4
```

Now add the cost of coherence. Same machines, and the curve turns back halfway:

```chart Speed-up
+ With coherence cost: 1 1.9 3.4 5.5 7.6 8.4 7.1
+ mark With coherence cost @ 32 : "peak"
```

The two curves have said what they came to say. This board comes down, and the conclusion goes up where it stood.

@overview

@erase

## So where is the saying wrong

Read together, the two curves say something quite unintuitive. The ceiling is set by the ((serial fraction)); the downturn is set by the ((coherence cost)); and the machine count only picks ==which point of that curve you are standing on==.

Not in its conclusion. In the two assumptions hiding underneath it — ((zero serial work)) and ((free coordination)).

@strike "If it is slow, add machines"

---

> Next time we measure those two coefficients on our own system, and then decide whether the next machine is worth buying.
