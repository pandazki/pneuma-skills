import { defineTile } from "gridboard";

interface Quote {
  text: string;
  author: string;
}

const QUOTES: Quote[] = [
  {
    text: "A computer would deserve to be called intelligent if it could deceive a human into believing that it was human.",
    author: "Alan Turing",
  },
  {
    text: "The Analytical Engine weaves algebraical patterns just as the Jacquard loom weaves flowers and leaves.",
    author: "Ada Lovelace",
  },
  {
    text: "Talk is cheap. Show me the code.",
    author: "Linus Torvalds",
  },
  {
    text: "The most dangerous phrase in the language is: we've always done it this way.",
    author: "Grace Hopper",
  },
  {
    text: "Simplicity is a great virtue but it requires hard work to achieve it and education to appreciate it.",
    author: "Edsger W. Dijkstra",
  },
  {
    text: "Beware of bugs in the above code; I have only proved it correct, not tried it.",
    author: "Donald Knuth",
  },
  {
    text: "Programs must be written for people to read, and only incidentally for machines to execute.",
    author: "Harold Abelson",
  },
  {
    text: "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.",
    author: "Martin Fowler",
  },
  {
    text: "First, solve the problem. Then, write the code.",
    author: "John Johnson",
  },
  {
    text: "The function of good software is to make the complex appear to be simple.",
    author: "Grady Booch",
  },
  {
    text: "Measuring programming progress by lines of code is like measuring aircraft building progress by weight.",
    author: "Bill Gates",
  },
  {
    text: "The best error message is the one that never shows up.",
    author: "Thomas Fuchs",
  },
  {
    text: "Make it work, make it right, make it fast.",
    author: "Kent Beck",
  },
  {
    text: "Code never lies; comments sometimes do.",
    author: "Ron Jeffries",
  },
  {
    text: "The most important property of a program is whether it accomplishes the intention of its user.",
    author: "C.A.R. Hoare",
  },
];

function getDailyQuote(): Quote {
  const today = new Date();
  const dayIndex =
    today.getFullYear() * 10000 +
    (today.getMonth() + 1) * 100 +
    today.getDate();
  return QUOTES[dayIndex % QUOTES.length];
}

export default defineTile({
  label: "Daily Quote",
  description: "A famous tech or programming quote, rotated daily",
  minSize: { cols: 2, rows: 2 },
  maxSize: { cols: 4, rows: 3 },
  // responsive breakpoints cover all sizes within min/max
  isOptimizedFor: () => true,

  render({ width, height }) {
    const quote = getDailyQuote();

    const isCompact = width < 220 || height < 160;
    const isLarge = width >= 340 && height >= 220;

    if (isCompact) {
      // Compact (2×2): truncated quote text only
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--tile-padding)",
            boxSizing: "border-box",
            fontFamily: "var(--font-family)",
            overflow: "hidden",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "0.7rem",
              lineHeight: 1.45,
              color: "var(--text-primary)",
              display: "-webkit-box",
              WebkitLineClamp: 5,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              fontStyle: "italic",
              textAlign: "center",
            }}
          >
            {quote.text}
          </p>
        </div>
      );
    }

    if (isLarge) {
      // Large: full quote + author + decorative quotation mark + accent border left
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            padding: "var(--tile-padding)",
            boxSizing: "border-box",
            fontFamily: "var(--font-family)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              borderLeft: "3px solid var(--accent)",
              paddingLeft: "16px",
              position: "relative",
              width: "100%",
            }}
          >
            {/* Decorative opening quotation mark */}
            <div
              style={{
                position: "absolute",
                top: "-8px",
                left: "12px",
                fontSize: "4rem",
                lineHeight: 1,
                color: "var(--accent)",
                opacity: 0.18,
                fontFamily: "Georgia, serif",
                userSelect: "none",
                pointerEvents: "none",
              }}
            >
              &ldquo;
            </div>

            <p
              style={{
                margin: "0 0 10px 0",
                fontSize: "0.85rem",
                lineHeight: 1.6,
                color: "var(--text-primary)",
                fontStyle: "italic",
                display: "-webkit-box",
                WebkitLineClamp: 6,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {quote.text}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "0.72rem",
                fontWeight: 600,
                color: "var(--accent)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              — {quote.author}
            </p>
          </div>
        </div>
      );
    }

    // Medium: full quote + author name
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "var(--tile-padding)",
          boxSizing: "border-box",
          fontFamily: "var(--font-family)",
          overflow: "hidden",
          gap: "10px",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "0.78rem",
            lineHeight: 1.55,
            color: "var(--text-primary)",
            fontStyle: "italic",
            display: "-webkit-box",
            WebkitLineClamp: 5,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          &ldquo;{quote.text}&rdquo;
        </p>
        <p
          style={{
            margin: 0,
            fontSize: "0.68rem",
            fontWeight: 600,
            color: "var(--text-secondary)",
            letterSpacing: "0.03em",
          }}
        >
          — {quote.author}
        </p>
      </div>
    );
  },
});
