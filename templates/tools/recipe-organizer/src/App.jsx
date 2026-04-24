import { useState, useEffect, useMemo } from 'react';

// ── Constants ────────────────────────────────────────────────
const CATEGORIES = ['All', 'Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Desserts'];
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const DIETARY_OPTIONS = ['Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free', 'Low-Carb', 'High-Protein'];

const GRADIENTS = [
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f5af19 0%, #f12711 100%)',
  'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)',
];

const DEFAULT_RECIPES = [
  {
    id: '1',
    name: 'Fluffy Pancakes',
    category: 'Breakfast',
    difficulty: 'Easy',
    prepTime: 10,
    cookTime: 15,
    servings: 4,
    dietary: ['Vegetarian'],
    gradient: GRADIENTS[0],
    description: 'Light, fluffy American-style pancakes. Perfect for a lazy weekend breakfast.',
    ingredients: [
      { amount: 1.5, unit: 'cups', item: 'all-purpose flour' },
      { amount: 3.5, unit: 'tsp', item: 'baking powder' },
      { amount: 1, unit: 'tbsp', item: 'sugar' },
      { amount: 0.25, unit: 'tsp', item: 'salt' },
      { amount: 1.25, unit: 'cups', item: 'milk' },
      { amount: 1, unit: '', item: 'egg' },
      { amount: 3, unit: 'tbsp', item: 'melted butter' },
    ],
    steps: [
      'Mix flour, baking powder, sugar, and salt in a large bowl.',
      'Make a well in the center. Pour in milk, egg, and melted butter. Mix until smooth.',
      'Heat a lightly oiled griddle or pan over medium-high heat.',
      'Pour about ¼ cup of batter per pancake. Cook until bubbles form on the surface, then flip.',
      'Cook until golden brown on the other side. Serve with maple syrup and fresh berries.',
    ],
  },
  {
    id: '2',
    name: 'Thai Basil Chicken',
    category: 'Dinner',
    difficulty: 'Medium',
    prepTime: 15,
    cookTime: 10,
    dietary: ['Dairy-Free', 'High-Protein'],
    servings: 2,
    gradient: GRADIENTS[1],
    description: 'Quick and flavorful stir-fry with ground chicken, Thai basil, and chili. Ready in 25 minutes.',
    ingredients: [
      { amount: 500, unit: 'g', item: 'ground chicken' },
      { amount: 4, unit: 'cloves', item: 'garlic, minced' },
      { amount: 3, unit: '', item: 'Thai chilies, sliced' },
      { amount: 2, unit: 'tbsp', item: 'soy sauce' },
      { amount: 1, unit: 'tbsp', item: 'oyster sauce' },
      { amount: 1, unit: 'tbsp', item: 'fish sauce' },
      { amount: 1, unit: 'tsp', item: 'sugar' },
      { amount: 1, unit: 'cup', item: 'Thai basil leaves' },
      { amount: 2, unit: 'tbsp', item: 'vegetable oil' },
    ],
    steps: [
      'Heat oil in a wok over high heat. Add garlic and chilies, stir-fry for 30 seconds.',
      'Add ground chicken. Break it apart and cook until no longer pink, about 4-5 minutes.',
      'Add soy sauce, oyster sauce, fish sauce, and sugar. Stir well.',
      'Toss in Thai basil leaves and stir until wilted, about 30 seconds.',
      'Serve immediately over steamed jasmine rice with a fried egg on top.',
    ],
  },
  {
    id: '3',
    name: 'Avocado Toast',
    category: 'Lunch',
    difficulty: 'Easy',
    prepTime: 5,
    cookTime: 3,
    servings: 1,
    dietary: ['Vegetarian', 'Dairy-Free', 'Vegan'],
    gradient: GRADIENTS[2],
    description: 'Elevated avocado toast with everything bagel seasoning and a squeeze of lemon.',
    ingredients: [
      { amount: 1, unit: '', item: 'ripe avocado' },
      { amount: 2, unit: 'slices', item: 'sourdough bread' },
      { amount: 1, unit: 'tbsp', item: 'lemon juice' },
      { amount: 0.25, unit: 'tsp', item: 'red pepper flakes' },
      { amount: 1, unit: 'tbsp', item: 'everything bagel seasoning' },
      { amount: 1, unit: 'pinch', item: 'flaky sea salt' },
    ],
    steps: [
      'Toast the sourdough bread until golden and crispy.',
      'Halve the avocado, remove the pit, and scoop into a bowl.',
      'Mash with a fork, leaving it slightly chunky. Add lemon juice and salt.',
      'Spread the avocado generously onto the toast.',
      'Top with red pepper flakes, everything bagel seasoning, and a pinch of flaky salt.',
    ],
  },
  {
    id: '4',
    name: 'Chocolate Lava Cake',
    category: 'Desserts',
    difficulty: 'Hard',
    prepTime: 20,
    cookTime: 12,
    servings: 4,
    dietary: ['Vegetarian'],
    gradient: GRADIENTS[3],
    description: 'Rich chocolate cake with a molten center. Impressive but easier than you think.',
    ingredients: [
      { amount: 120, unit: 'g', item: 'dark chocolate (70%)' },
      { amount: 120, unit: 'g', item: 'unsalted butter' },
      { amount: 2, unit: '', item: 'eggs' },
      { amount: 2, unit: '', item: 'egg yolks' },
      { amount: 60, unit: 'g', item: 'sugar' },
      { amount: 2, unit: 'tbsp', item: 'all-purpose flour' },
      { amount: 1, unit: 'pinch', item: 'salt' },
    ],
    steps: [
      'Preheat oven to 220°C (425°F). Butter and flour four ramekins.',
      'Melt chocolate and butter together in a double boiler or microwave. Stir until smooth.',
      'Whisk eggs, egg yolks, and sugar until thick and pale, about 2 minutes.',
      'Fold the chocolate mixture into the eggs. Add flour and salt, fold gently.',
      'Divide batter among ramekins. Bake for exactly 12 minutes — edges should be firm, center soft.',
      'Let cool for 1 minute, then invert onto plates. Serve immediately with vanilla ice cream.',
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────
function scaleAmount(amount, baseServings, targetServings) {
  return Math.round((amount * targetServings / baseServings) * 100) / 100;
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [recipes, setRecipes] = useState([]);
  const [currentView, setCurrentView] = useState('list');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [viewServings, setViewServings] = useState(null);

  // Form state
  const emptyForm = {
    name: '', category: 'Dinner', difficulty: 'Easy', prepTime: '', cookTime: '',
    servings: 4, dietary: [], description: '',
    ingredientText: '', stepsText: '',
  };
  const [form, setForm] = useState(emptyForm);

  // Load/save
  useEffect(() => {
    const saved = localStorage.getItem('ro-recipes');
    setRecipes(saved ? JSON.parse(saved) : DEFAULT_RECIPES);
  }, []);

  useEffect(() => {
    if (recipes.length > 0 || localStorage.getItem('ro-recipes')) {
      localStorage.setItem('ro-recipes', JSON.stringify(recipes));
    }
  }, [recipes]);

  // ── Filter ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return recipes.filter((r) => {
      const matchesCat = category === 'All' || r.category === category;
      const q = search.toLowerCase();
      const matchesSearch = !q || r.name.toLowerCase().includes(q) ||
        r.ingredients.some((i) => i.item.toLowerCase().includes(q));
      return matchesCat && matchesSearch;
    });
  }, [recipes, category, search]);

  // ── Current Recipe ─────────────────────────────────────────
  const currentRecipe = typeof currentView === 'string' && currentView !== 'list'
    ? recipes.find((r) => r.id === currentView)
    : null;

  const openRecipe = (id) => {
    const recipe = recipes.find((r) => r.id === id);
    setCurrentView(id);
    setViewServings(recipe?.servings || 4);
  };

  const goHome = () => { setCurrentView('list'); setViewServings(null); };

  // ── Add / Edit ─────────────────────────────────────────────
  const openAddForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEditForm = (recipe) => {
    setEditingId(recipe.id);
    setForm({
      name: recipe.name,
      category: recipe.category,
      difficulty: recipe.difficulty,
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      servings: recipe.servings,
      dietary: [...recipe.dietary],
      description: recipe.description,
      ingredientText: recipe.ingredients.map((i) =>
        `${i.amount}${i.unit ? ' ' + i.unit : ''} ${i.item}`
      ).join('\n'),
      stepsText: recipe.steps.join('\n'),
    });
    setShowForm(true);
  };

  const saveRecipe = () => {
    if (!form.name.trim()) return;
    const ingredients = form.ingredientText.split('\n').filter(Boolean).map((line) => {
      const match = line.match(/^([\d./]+)\s*(\w*)\s+(.+)/);
      if (match) return { amount: parseFloat(match[1]) || 1, unit: match[2], item: match[3] };
      return { amount: 1, unit: '', item: line.trim() };
    });
    const steps = form.stepsText.split('\n').filter(Boolean).map((s) => s.trim());

    const recipe = {
      id: editingId || Date.now().toString(),
      name: form.name.trim(),
      category: form.category,
      difficulty: form.difficulty,
      prepTime: parseInt(form.prepTime) || 0,
      cookTime: parseInt(form.cookTime) || 0,
      servings: parseInt(form.servings) || 4,
      dietary: form.dietary,
      description: form.description.trim(),
      gradient: GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)],
      ingredients,
      steps,
    };

    if (editingId) {
      const old = recipes.find((r) => r.id === editingId);
      recipe.gradient = old?.gradient || recipe.gradient;
      setRecipes((prev) => prev.map((r) => r.id === editingId ? recipe : r));
    } else {
      setRecipes((prev) => [recipe, ...prev]);
    }
    setShowForm(false);
  };

  const deleteRecipe = (id) => {
    setRecipes((prev) => prev.filter((r) => r.id !== id));
    if (currentView === id) goHome();
  };

  const toggleDietary = (tag) => {
    setForm((f) => ({
      ...f,
      dietary: f.dietary.includes(tag) ? f.dietary.filter((t) => t !== tag) : [...f.dietary, tag],
    }));
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          {currentView === 'list' ? (
            <>
              <h1 className="app-title">🍳 Recipe Book</h1>
              <span className="app-subtitle">{recipes.length} recipes saved</span>
            </>
          ) : (
            <button className="back-btn" onClick={goHome}>← All Recipes</button>
          )}
        </div>
        {currentView === 'list' && (
          <button className="btn btn-primary" onClick={openAddForm}>+ New Recipe</button>
        )}
      </header>

      {/* ── LIST VIEW ── */}
      {currentView === 'list' && (
        <>
          {/* Search & Filters */}
          <div className="filters-bar">
            <div className="search-box">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search recipes or ingredients..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="search-input"
              />
              {search && <button className="search-clear" onClick={() => setSearch('')}>✕</button>}
            </div>
            <div className="category-pills">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  className={`pill ${category === c ? 'active' : ''}`}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Recipe Grid */}
          {filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🍽️</div>
              <h2>No recipes found</h2>
              <p>Try a different search or add a new recipe.</p>
            </div>
          ) : (
            <div className="recipe-grid">
              {filtered.map((recipe) => (
                <div key={recipe.id} className="recipe-card" onClick={() => openRecipe(recipe.id)}>
                  <div className="recipe-image" style={{ background: recipe.gradient }}>
                    <div className="recipe-badges">
                      <span className="badge difficulty">{recipe.difficulty}</span>
                    </div>
                  </div>
                  <div className="recipe-body">
                    <span className="recipe-category">{recipe.category}</span>
                    <h3 className="recipe-name">{recipe.name}</h3>
                    <p className="recipe-desc">{recipe.description}</p>
                    <div className="recipe-meta">
                      <span>🕐 {recipe.prepTime + recipe.cookTime} min</span>
                      <span>👤 {recipe.servings} servings</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── DETAIL VIEW ── */}
      {currentRecipe && (
        <div className="recipe-detail">
          <div className="detail-hero" style={{ background: currentRecipe.gradient }}>
            <div className="detail-hero-overlay">
              <span className="badge difficulty large">{currentRecipe.difficulty}</span>
            </div>
          </div>

          <div className="detail-content">
            <div className="detail-top">
              <div>
                <span className="recipe-category">{currentRecipe.category}</span>
                <h1 className="detail-name">{currentRecipe.name}</h1>
                <p className="detail-desc">{currentRecipe.description}</p>
              </div>
              <div className="detail-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => openEditForm(currentRecipe)}>✏️ Edit</button>
                <button className="btn btn-danger-sm" onClick={() => deleteRecipe(currentRecipe.id)}>🗑️</button>
              </div>
            </div>

            {/* Meta chips */}
            <div className="detail-chips">
              <span className="chip">🕐 Prep: {currentRecipe.prepTime}m</span>
              <span className="chip">🔥 Cook: {currentRecipe.cookTime}m</span>
              <span className="chip">⏱️ Total: {currentRecipe.prepTime + currentRecipe.cookTime}m</span>
              {currentRecipe.dietary.map((d) => (
                <span key={d} className="chip dietary">{d}</span>
              ))}
            </div>

            <div className="detail-grid">
              {/* Ingredients */}
              <div className="detail-section">
                <div className="detail-section-header">
                  <h2>Ingredients</h2>
                  <div className="servings-control">
                    <button
                      className="servings-btn"
                      onClick={() => setViewServings((s) => Math.max(1, s - 1))}
                    >
                      −
                    </button>
                    <span className="servings-value">{viewServings} servings</span>
                    <button
                      className="servings-btn"
                      onClick={() => setViewServings((s) => s + 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
                <ul className="ingredient-list">
                  {currentRecipe.ingredients.map((ing, i) => (
                    <li key={i} className="ingredient-item">
                      <span className="ing-amount">
                        {scaleAmount(ing.amount, currentRecipe.servings, viewServings)}
                        {ing.unit ? ` ${ing.unit}` : ''}
                      </span>
                      <span className="ing-name">{ing.item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Steps */}
              <div className="detail-section">
                <h2>Instructions</h2>
                <ol className="steps-list">
                  {currentRecipe.steps.map((step, i) => (
                    <li key={i} className="step-item">
                      <span className="step-num">{i + 1}</span>
                      <span className="step-text">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD/EDIT MODAL ── */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit Recipe' : 'New Recipe'}</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group flex-2">
                  <label>Recipe Name</label>
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Grandma's Pasta" autoFocus />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.filter((c) => c !== 'All').map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Prep (min)</label>
                  <input type="number" min="0" value={form.prepTime} onChange={(e) => setForm({ ...form, prepTime: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Cook (min)</label>
                  <input type="number" min="0" value={form.cookTime} onChange={(e) => setForm({ ...form, cookTime: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Servings</label>
                  <input type="number" min="1" value={form.servings} onChange={(e) => setForm({ ...form, servings: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Difficulty</label>
                  <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                    {DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Description</label>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Short description of the dish" />
              </div>

              <div className="form-group">
                <label>Dietary Tags</label>
                <div className="dietary-pills">
                  {DIETARY_OPTIONS.map((d) => (
                    <button key={d} className={`pill small ${form.dietary.includes(d) ? 'active' : ''}`} onClick={() => toggleDietary(d)}>{d}</button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Ingredients <span className="form-hint">(one per line: "2 cups flour")</span></label>
                <textarea rows={6} value={form.ingredientText} onChange={(e) => setForm({ ...form, ingredientText: e.target.value })} placeholder={"1.5 cups flour\n2 eggs\n1 cup milk"} />
              </div>

              <div className="form-group">
                <label>Steps <span className="form-hint">(one per line)</span></label>
                <textarea rows={6} value={form.stepsText} onChange={(e) => setForm({ ...form, stepsText: e.target.value })} placeholder={"Preheat oven to 180°C\nMix dry ingredients\nAdd wet ingredients"} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveRecipe} disabled={!form.name.trim()}>
                {editingId ? 'Save Changes' : 'Add Recipe'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
