# 👶 BabyDoc

AI-помічник для батьків з питань догляду за дітьми. Telegram бот на основі RAG (Retrieval-Augmented Generation) з медичними джерелами AAP.

## 🚀 Швидкий старт

```bash
# Встановити залежності
npm install

# Налаштувати змінні оточення
cp .env.example .env
# Заповнити .env своїми ключами

# Запустити бота
npm start
```

## 📁 Структура проекту

```
babydoc/
├── src/
│   ├── bot/          # Telegram бот (Telegraf)
│   ├── services/     # RAG сервіс, User сервіс
│   └── config/       # Конфігурація джерел
├── scripts/
│   ├── parse-pdfs.ts # PDF → Markdown (LlamaParse)
│   └── ingest.ts     # Markdown → Supabase vectors
└── data/
    ├── raw/          # PDF книги
    └── markdown/     # Спарсені markdown файли
```

## ⚙️ Технології

- **Bot**: Telegraf (Telegram)
- **LLM**: GPT-4o (OpenAI)
- **Embeddings**: OpenAI Ada
- **Reranking**: Cohere Rerank v3.5
- **Vector DB**: Supabase (pgvector)
- **Parsing**: LlamaParse

## 🔧 Скрипти

```bash
npm run parse    # Парсинг PDF → Markdown
npm run ingest   # Завантаження в Supabase
npm start        # Запуск бота
npm run dev      # Розробка (hot reload)
```

## 📚 Джерела

- Caring for Your Baby and Young Child (AAP) — основне джерело

## ⚠️ Дисклеймер

Бот не замінює консультацію лікаря. Завжди звертайтесь до педіатра з медичними питаннями.
