// Fixed example profiles for checking recommendation behavior.
// These are made-up viewers, not real personal data. Every show that is not
// rated or listed as seen is treated as Not seen, so the whole eligible pool
// is available to rank.

module.exports = [
  {
    name: "warm-family",
    description: "Likes warm family sitcoms; dislikes crude and cynical shows.",
    ratings: {
      "full-house-1987": "yes",
      "family-matters-1989": "yes",
      "growing-pains-1985": "yes",
      "home-improvement-1991": "yes",
      "the-wonder-years-1988": "yes",
      "south-park-1997": "no",
      "it-s-always-sunny-in-philadelphia-2005": "no",
      "married-with-children-1987": "meh",
    },
    seen: ["saved-by-the-bell-1989"],
  },
  {
    name: "cringe-satire",
    description: "Likes awkward, cynical single-camera comedy; dislikes wholesome family shows.",
    ratings: {
      "curb-your-enthusiasm-2000": "yes",
      "the-office-uk-2001": "yes",
      "arrested-development-2003": "yes",
      "veep-2012": "yes",
      "peep-show-2003": "yes",
      "full-house-1987": "no",
      "saved-by-the-bell-1989": "no",
      "home-improvement-1991": "meh",
    },
    seen: [],
  },
  {
    name: "workplace-classics",
    description: "Likes 1970s-80s workplace ensembles; mixed on family shows.",
    ratings: {
      "cheers-1982": "yes",
      "taxi-1978": "yes",
      "barney-miller-1975": "yes",
      "wkrp-in-cincinnati-1978": "yes",
      "the-mary-tyler-moore-show-1970": "yes",
      "night-court-1984": "meh",
      "growing-pains-1985": "no",
    },
    seen: ["m-a-s-h-1972", "the-bob-newhart-show-1972"],
  },
  {
    name: "animation",
    description: "Likes adult animation; dislikes multi-camera romance sitcoms.",
    ratings: {
      "the-simpsons-1989": "yes",
      "king-of-the-hill-1997": "yes",
      "futurama-1999": "yes",
      "bob-s-burgers-2011": "yes",
      "friends-1994": "no",
      "the-big-bang-theory-2007": "no",
    },
    seen: [],
  },
  {
    name: "sparse",
    description: "Only one rating so far: should get an honest 'not enough evidence' message.",
    ratings: { "seinfeld-1989": "yes" },
    seen: ["friends-1994", "frasier-1993"],
  },
];
