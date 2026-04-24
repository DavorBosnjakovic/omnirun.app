import { useState, useMemo } from 'react';
import Navbar from './components/Navbar';
import ArticleList from './components/ArticleList';
import ArticleView from './components/ArticleView';

// ── Sample Articles ──────────────────────────────────────────
// Replace with data from your CMS or backend
const ARTICLES = [
  {
    id: 1,
    title: 'The Case for Building Slower',
    excerpt: 'In a world obsessed with shipping fast, there\'s a hidden advantage to slowing down and getting the foundations right.',
    category: 'Product',
    author: 'Elena Voss',
    date: '2025-01-15',
    readTime: 6,
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    body: [
      'The startup world has an obsession with speed. Ship fast, break things, iterate. It\'s become gospel — and for good reason. Speed kills indecision. Speed creates momentum. Speed lets you learn.',
      'But there\'s a shadow side to velocity that nobody talks about at demo day.',
      'When you ship fast without thinking deeply, you accumulate a different kind of debt. Not just technical debt (though there\'s plenty of that). I\'m talking about *design debt* — the slow erosion of coherence that happens when every feature is a reaction rather than a decision.',
      'The best products I\'ve used share a quality that\'s hard to name but easy to feel: inevitability. Everything is where you expect it. Features connect to each other in ways that feel natural. The whole thing hangs together like it was designed by one mind.',
      'That quality doesn\'t come from shipping fast. It comes from thinking clearly, saying no often, and having the patience to wait until you truly understand the problem before building the solution.',
      'This isn\'t an argument against speed. It\'s an argument against *thoughtless* speed. The distinction matters. You can move quickly and still be deliberate. You can ship weekly and still have a coherent vision.',
      'The trick is knowing when to sprint and when to pause. Sprint on execution. Pause on direction.',
      'Next time you feel pressure to ship something half-baked, ask yourself: will this decision still make sense in six months? If the answer is "I don\'t know," that\'s your signal to slow down.'
    ],
  },
  {
    id: 2,
    title: 'Design Systems Are Gardens, Not Blueprints',
    excerpt: 'Why the best design systems evolve organically — and what happens when you try to plan every pixel upfront.',
    category: 'Design',
    author: 'Marcus Chen',
    date: '2025-01-08',
    readTime: 8,
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    body: [
      'I\'ve seen teams spend months building design systems before writing a single line of product code. They catalog every button variant, every spacing token, every color in every shade. The Figma file is a masterpiece.',
      'And then it all falls apart the moment real product work begins.',
      'The problem isn\'t the system — it\'s the metaphor. These teams think of design systems as blueprints: detailed plans you draft before construction begins. But systems that work are more like gardens.',
      'A garden starts with a few plants. You see what thrives. You pull what doesn\'t work. Over time, the garden develops character — not from a master plan, but from hundreds of small decisions made in response to real conditions.',
      'The best design systems I\'ve worked with started with just a handful of components: a button, a text input, a card, a few type styles. They grew as the product grew. Components were added when two or more teams needed the same pattern.',
      'The key insight: don\'t abstract before you have evidence of repetition. If you build a component library before building the product, you\'re guessing about what you\'ll need. You\'ll guess wrong.',
      'Start with the product. Let patterns emerge. Formalize them when the cost of inconsistency exceeds the cost of abstraction. That\'s the gardener\'s approach.',
      'Your system will be messier than a blueprint. It will also be alive.'
    ],
  },
  {
    id: 3,
    title: 'What I Learned From 50 Failed Side Projects',
    excerpt: 'A brutally honest retrospective on why most of my side projects never shipped — and the three that actually did.',
    category: 'Personal',
    author: 'Elena Voss',
    date: '2024-12-28',
    readTime: 10,
    gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    body: [
      'I\'ve started over 50 side projects in the last decade. I\'ve shipped exactly three.',
      'For years I thought the problem was discipline. If I could just *stick with it*, I\'d finish more. So I tried accountability partners, public build logs, and productivity systems.',
      'None of it worked. And eventually I realized: discipline wasn\'t the problem. The problem was that I was building things nobody needed — including me.',
      'Most of my abandoned projects shared a pattern: I was excited about the *technology*, not the *problem*. "Ooh, I should build a real-time collaborative editor!" No. Nobody asked for that. I just wanted to play with CRDTs.',
      'The three projects I actually finished had something in common: I was the user. I built them because I had a genuine itch that existing tools didn\'t scratch.',
      'Project 1: A dead-simple invoice generator because I was tired of QuickBooks for my freelance work. Took a weekend. Still use it.',
      'Project 2: A reading list tracker with no social features, no gamification, just a list. Built it in two evenings because every other app tried to be Goodreads.',
      'Project 3: A CLI tool to organize my screenshots folder by date. Absurdly simple. Absurdly useful.',
      'The lesson: build for a problem you feel in your bones. The motivation takes care of itself.',
      'Everything else is just procrastination in disguise.'
    ],
  },
  {
    id: 4,
    title: 'The Quiet Power of Boring Technology',
    excerpt: 'PostgreSQL, server-rendered HTML, cron jobs. Why the most reliable systems are built with the least exciting tools.',
    category: 'Engineering',
    author: 'James Kofi',
    date: '2024-12-18',
    readTime: 7,
    gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    body: [
      'Every few months, a new framework promises to change everything. And every few months, the most reliable systems in production are still running on PostgreSQL, nginx, and cron jobs.',
      'There\'s a reason for this. Boring technology has a superpower: it\'s predictable. When something goes wrong at 3 AM, you can Google the error and find a Stack Overflow answer from 2014 that still works.',
      'I spent two years at a startup that used cutting-edge everything. Event sourcing, CQRS, microservices, Kubernetes, GraphQL federation. On paper, it was beautiful.',
      'In practice, we spent 60% of our engineering time fighting the infrastructure. Every tool had sharp edges. Documentation was sparse or wrong. When services failed, the failure modes were novel and terrifying.',
      'At my current company, we run a monolith. PostgreSQL. Server-rendered HTML with a sprinkle of JavaScript. Redis for caching. Cron for scheduled tasks.',
      'It\'s not exciting. But it works. Our on-call rotation is quiet. Deploys are boring. New engineers are productive on day one because everyone already knows these tools.',
      'I\'m not saying never use new technology. I\'m saying: earn the right to use it. Start with boring. Add complexity only when boring breaks. You\'ll be surprised how far boring takes you.'
    ],
  },
  {
    id: 5,
    title: 'Writing as a Design Tool',
    excerpt: 'Before wireframes, before Figma, before any visual work — the most underrated design tool is a blank document.',
    category: 'Design',
    author: 'Marcus Chen',
    date: '2024-12-10',
    readTime: 5,
    gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    body: [
      'When I start a new design project, the first thing I open isn\'t Figma. It\'s a text editor.',
      'Before I draw a single box, I write. I describe the problem in plain language. I write out the user\'s journey as a story. I list the decisions the user needs to make and the information they need to make them.',
      'This sounds simple, and it is. That\'s the point.',
      'Visual tools are powerful, but they seduce you into solving layout problems before you\'ve solved *thinking* problems. You start pushing pixels before you know what the pixels should say.',
      'Writing forces clarity. You can\'t hand-wave in prose the way you can in a wireframe. A box labeled "content" can mean anything. A sentence describing what the user reads at this moment can\'t hide behind abstraction.',
      'I keep the writing short — usually one page. It\'s not a spec or a PRD. It\'s more like a letter to the user explaining how this feature works. If I can\'t explain it clearly in writing, I can\'t design it clearly in pixels.',
      'Try it on your next project. Write before you design. The wireframes that follow will be sharper, faster, and more coherent.',
      'The best design tool is still a blank page and clear thinking.'
    ],
  },
  {
    id: 6,
    title: 'Remote Work Killed the Meeting — And That\'s Good',
    excerpt: 'Three years into the remote experiment, the real winners aren\'t the people with the best home offices.',
    category: 'Personal',
    author: 'James Kofi',
    date: '2024-11-30',
    readTime: 6,
    gradient: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
    body: [
      'When the office closed in 2020, everyone worried about collaboration. How would we brainstorm? How would we stay aligned? How would we maintain culture?',
      'Three years later, the answers are clear. And they\'re not what anyone expected.',
      'The biggest change wasn\'t where we work. It was how we communicate. When you can\'t tap someone on the shoulder, you learn to write things down. When you can\'t have a quick huddle, you learn to document decisions.',
      'This turned out to be a massive upgrade.',
      'In the office, knowledge lived in people\'s heads and in hallway conversations. Remote, it lives in shared documents, recorded Looms, and searchable Slack threads. New hires can find context without scheduling a meeting.',
      'Speaking of meetings: we killed most of them. Our team went from 12 hours of meetings per week to about 4. The rest became async documents with comment threads.',
      'The result? More time for actual work. More thoughtful responses (because people had time to think before responding). Better documentation. Fewer interruptions.',
      'Remote work didn\'t just change where we sit. It forced us to build better communication habits. And those habits are valuable whether you\'re remote, hybrid, or fully in-office.',
      'The real lesson of the remote experiment isn\'t about location. It\'s about intentionality.'
    ],
  },
];

const CATEGORIES = ['All', 'Product', 'Design', 'Engineering', 'Personal'];

export default function App() {
  const [currentView, setCurrentView] = useState('list'); // 'list' or article id
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  // ── Filtered Articles ──────────────────────────────────────
  const filteredArticles = useMemo(() => {
    return ARTICLES.filter((article) => {
      const matchesCategory = activeCategory === 'All' || article.category === activeCategory;
      const matchesSearch =
        !searchQuery ||
        article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        article.excerpt.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, searchQuery]);

  // ── Navigation ─────────────────────────────────────────────
  const openArticle = (id) => {
    setCurrentView(id);
    window.scrollTo(0, 0);
  };

  const goHome = () => {
    setCurrentView('list');
    window.scrollTo(0, 0);
  };

  // ── Current Article + Related ──────────────────────────────
  const currentArticle = typeof currentView === 'number'
    ? ARTICLES.find((a) => a.id === currentView)
    : null;

  const relatedArticles = currentArticle
    ? ARTICLES.filter((a) => a.id !== currentArticle.id && a.category === currentArticle.category).slice(0, 2)
    : [];

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="app">
      <Navbar
        categories={CATEGORIES}
        activeCategory={activeCategory}
        onCategoryChange={(cat) => { setActiveCategory(cat); setCurrentView('list'); }}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onLogoClick={goHome}
        showSearch={currentView === 'list'}
      />

      <main className="main">
        {currentView === 'list' ? (
          <ArticleList
            articles={filteredArticles}
            onArticleClick={openArticle}
          />
        ) : currentArticle ? (
          <ArticleView
            article={currentArticle}
            related={relatedArticles}
            onBack={goHome}
            onArticleClick={openArticle}
          />
        ) : null}
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <span className="footer-logo" onClick={goHome}>The<span>Margin</span></span>
          <span className="footer-copy">© 2025 The Margin. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
