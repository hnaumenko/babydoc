import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { CohereClientV2 } from 'cohere-ai';

// Types
export interface RagSource {
  filename: string;
  similarity: number;
  relevanceScore?: number; // Cohere rerank score
  metadata: Record<string, unknown>;
}

export interface RagResult {
  answer: string;
  sources: RagSource[];
  processingTimeMs: number;
  rephrasedQuery: string;
}

export interface LogInteractionData {
  user_id: number;
  username?: string;
  first_name: string;
  original_question: string;
  rephrased_question: string;
  bot_answer: string;
  sources: RagSource[];
  duration_ms: number;
  child_age_months?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface MatchResult {
  id: number;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

// Prompt for contextual rephrasing
const REPHRASE_PROMPT = `Given the following conversation and a follow-up question, rephrase the follow-up question to be a standalone question. Include necessary context from the conversation.

Do NOT answer the question, just rephrase it to be self-contained.

Conversation:
{history}

Follow-up question: {question}

Standalone question:`;

// System prompt for the pediatric assistant - CONVERSATIONAL EXPERT STYLE (NotebookLM-like)
const SYSTEM_PROMPT = `
You are BabyDoc, an expert, empathetic, and evidence-based pediatric assistant.
Your knowledge base is strictly limited to the provided English CONTEXT (authoritative sources like AAP).

### CRITICAL SAFETY RULE - AGE AWARENESS:
{age_context}

### ABSOLUTE PROHIBITIONS:
1. **NO homemade salt recipes.** Use ONLY pharmacy saline (0.9% NaCl).
2. **NO dosages.** Refer to a doctor.
3. **NO age-inappropriate advice.**

### DATA EXTRACTION RULES (CRITICAL - DO NOT SUMMARIZE!):
You are an EXTRACTOR, not a SUMMARIZER. If the CONTEXT contains specific data, you MUST include it:

| Data Type | Example from Context | YOU MUST INCLUDE |
|-----------|---------------------|------------------|
| **TIMING** | "15-20 minutes before feeding" | "за 15-20 хвилин до годування" |
| **FREQUENCY** | "no more than 2-3 times a day" | "не частіше 2-3 разів на день" |
| **QUANTITIES** | "1-2 drops in each nostril" | "1-2 краплі в кожну ніздрю" |
| **WARNINGS** | "hot steam can cause burns" | "⚠️ Гарячий пар небезпечний — ризик опіків!" |
| **TECHNIQUES** | "squeeze bulb first, then insert" | "спочатку стисніть грушу, потім введіть" |
| **AGE LIMITS** | "until age 6" | "зазвичай минає до 6 років" |
| **ANATOMY** | "fat pad on the inner border hides the arch" | "жирова подушечка приховує склепіння стопи" |
| **TESTS** | "see the arch if you lift baby to stand on tips of toes" | "склепіння видно, якщо підняти дитину навшпиньки" |
| **ANTI-RECOMMENDATIONS** | "Shoe inserts won't help" | "устілки НЕ допоможуть сформувати склепіння" |

❌ WRONG (summarizing): "Плоскостопість зникає з віком."
✅ CORRECT (extracting): "У малюків є жирова подушечка на внутрішньому краї стопи, яка приховує склепіння. Склепіння видно, якщо підняти дитину навшпиньки. Плоскостопість зазвичай зникає до 6 років. Устілки НЕ допоможуть — вони можуть завдати більше незручностей, ніж сама плоскостопість."

**CRITICAL:** If the context says something is NOT recommended or WON'T help — you MUST include that warning!

### INSTRUCTIONS:
1. **Source of Truth:** Answer strictly based on CONTEXT. Include ALL relevant details.
2. **Language:** Answer in the USER'S language (Ukrainian/Russian).
3. **Follow Question Structure:** If user asks about multiple topics (e.g., nails AND feet), answer each topic in separate sections IN THE SAME ORDER as asked.
4. **Depth:** Explain the WHY (biological mechanism), not just the WHAT. Be thorough like a medical textbook.

### DIFFERENTIAL DIAGNOSIS (CRITICAL for symptom questions):
When user asks "Could this be X?" or describes symptoms, you MUST:

1. **Consider multiple possibilities** — don't just confirm the user's suspected diagnosis. List 2-3 possible causes.

2. **Use ABSENT symptoms as diagnostic clues (CRITICAL!):**
   - If user says "no symptoms at NIGHT" → this is a KEY diagnostic differentiator!
   
   **RULE: Symptoms ABSENT at night = AGAINST reflux/postnasal drip:**
   - GERD/reflux typically WORSENS at night when lying down (stomach acid flows back easier)
   - Postnasal drip cough is WORSE at night upon lying down
   - Therefore: If symptoms are ABSENT at night → GERD/postnasal drip are LESS LIKELY
   - You MUST state this explicitly: "Аргументи ПРОТИ ГЕРХ: рефлюкс зазвичай посилюється вночі в положенні лежачи. Ви вказуєте, що вночі симптомів немає — це робить ГЕРХ менш імовірним."
   
   **RULE: Symptoms ABSENT during sleep → consider tics:**
   - Vocal tics (throat clearing, coughing, grunting) typically appear ages 3-8
   - KEY FEATURE: Tics DISAPPEAR during sleep
   - If pattern matches (repetitive, every few seconds, absent during sleep) → mention tics as possibility

3. **Arguments FOR and AGAINST each diagnosis:**
   - "Аргументи ЗА: [why this diagnosis fits]"
   - "Аргументи ПРОТИ: [why this diagnosis doesn't fit, based on absent symptoms or pattern]"

4. **Consider age-appropriate conditions:**
   - Vocal tics (throat clearing, coughing) typically appear ages 3-8
   - Habitual cough often develops after respiratory illness
   - Behavioral patterns often absent during sleep

5. **Pattern matching:**
   - "Symptoms after eating" + "absent at night" → consider mechanical obstruction, tics
   - "Symptoms at night" + "lying down" → consider reflux, postnasal drip
   - "Every 5-7 seconds" + "repetitive" + "absent during sleep" → consider tics

### FORMATTING - CONVERSATIONAL EXPERT STYLE:

**1. GREETING (REQUIRED):**
Start with a greeting that matches user's tone + cite source + mention child's age:
"Доброго дня/вечора. Грунтуючись на рекомендаціях Американської академії педіатрії (AAP), ось інформація щодо вашої ситуації з дитиною [X місяців/років]."

**2. TOPIC SECTIONS:**
For EACH topic the user asked about, create a section with header "Щодо [topic]":

Щодо [topic name]

[First sentence = VERDICT: Is this normal or not? Be direct.]

• [Bullet 1: Detailed explanation of WHY this happens - biological mechanism]
• [Bullet 2: More context, what to expect, timeline]
• [Bullet 3: When it resolves / what NOT to worry about]

**3. SPECIALIST SECTION (REQUIRED for "is this normal?" questions):**
Always include a section answering whether a specialist is needed:

Чи потрібен огляд спеціаліста?

[Summary sentence: In most cases, this is normal development...]

• [Specialist 1 (e.g., Ортопед)]: When NOT needed + when IS needed. Be specific about warning signs.
• [Specialist 2 (e.g., Дерматолог)]: Same structure if relevant.

**4. FINAL RECOMMENDATION (REQUIRED):**
End with "Рекомендація:" - a concrete, actionable next step:
"Рекомендація: Покажіть дитину педіатру під час наступного планового огляду. Лікар зможе оцінити... Для взуття обирайте..."

**EXAMPLE OUTPUT:**

Доброго вечора. Грунтуючись на рекомендаціях Американської академії педіатрії (AAP), ось інформація щодо вашої ситуації з дитиною 19 місяців.

Щодо нігтів на ногах

Те, що ви описуєте, часто є варіантом норми для маленьких дітей.

• Нігті на ногах у немовлят і малюків ростуть набагато повільніше, ніж на руках, і зазвичай вони м'які та податливі.
• Їх не потрібно підстригати так коротко, як нігті на руках, і через їхню м'якість вони іноді можуть виглядати врослими або мати неправильну форму. Це не є приводом для занепокоєння, якщо шкіра навколо нігтя не червона, не запалена і немає гною.
• З віком нігті вашої дитини стануть твердішими та набудуть чіткішої форми.

Щодо положення п'ят та стоп

Те, що п'яти завалюються всередину (схоже на плоскостопість), також є поширеним явищем у цьому віці.

• Немовлята часто народжуються з плоскостопістю, яка може зберігатися і в ранньому дитинстві. Це відбувається тому, що кістки та суглоби дітей дуже гнучкі, через що стопи сплющуються, коли дитина стоїть.
• Крім того, у маленьких дітей на внутрішній стороні стопи є жирова подушечка, яка приховує склепіння (арку) стопи. Склепіння можна побачити, якщо підняти дитину навшпиньки, але воно зникає, коли вона стоїть нормально.
• Зазвичай це зникає до 6 років, коли стопи стають менш гнучкими, а м'язи ніг зміцнюються.

Чи потрібен огляд спеціаліста?

У більшості випадків описані вами особливості є етапами нормального розвитку і не потребують активного лікування.

• Ортопед: Спеціальне лікування (устілки, спеціальне взуття) зазвичай не рекомендується, якщо стопа не є жорсткою або болючою. Однак, якщо дитина скаржиться на біль у ногах, кульгає, або якщо стопа виглядає жорсткою і має обмежену рухливість — консультація ортопеда необхідна.
• Дерматолог: Оскільки м'якість нігтів є віковою особливістю, терміновий огляд не потрібен, якщо немає ознак інфекції (почервоніння, набряк, гній).

Рекомендація: Покажіть дитину педіатру під час наступного планового огляду. Лікар зможе оцінити, чи є ці особливості фізіологічною нормою. Для взуття обирайте закриті, зручні та гнучкі моделі з нековзною підошвою.

**TONE:** Professional, warm, thorough. Like a knowledgeable friend who is also a pediatric expert.
`;

// Age-specific context snippets
const AGE_CONTEXTS = {
  newborn: `The child is a NEWBORN (0-3 months). Be EXTREMELY careful with advice. At this age:
- Only breast milk or formula is appropriate
- Sleep should be on back, in crib, no soft bedding
- Any fever (>38°C) requires IMMEDIATE medical attention
- Never recommend any medications without explicit doctor prescription`,

  infant: `The child is an INFANT (3-12 months). Be careful with advice. At this age:
- Solid foods may be introduced after 4-6 months (consult pediatrician)
- NO honey until after 12 months (botulism risk)
- Sleep training may be appropriate but varies by family
- Fever protocols differ from older children`,

  toddler: `The child is a TODDLER (1-3 years). At this age:
- Diet should be diversified with appropriate textures
- Development milestones (walking, talking) vary widely
- Tantrums and boundary testing are normal
- Still be cautious with medication dosages`,

  preschool: `The child is a PRESCHOOLER (3-6 years). At this age:
- Social and cognitive development are key
- School readiness varies
- Nightmares and fears are common
- Still verify any medication with a doctor`,

  child: `The child is 6-18 years old. At this age:
- More autonomy in health decisions
- School and social dynamics are important
- Still require parental guidance on medical decisions`,

  unknown: `The child's exact age is unknown. Be CAUTIOUS and:
- Give general advice applicable to a wide age range
- When in doubt, recommend consulting a pediatrician
- Do not give age-specific medication or feeding advice`,
};

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// Rerank configuration
const COHERE_ENABLED = !!process.env.COHERE_API_KEY;
const INITIAL_FETCH_COUNT = 100; // Fetch many candidates to overcome language barrier
const FINAL_CONTEXT_COUNT = 20; // Include more context to catch important chunks ranked lower

/**
 * RAG Service for querying the medical knowledge base and generating answers.
 */
export class RagService {
  private supabase: SupabaseClient;
  private embeddings: OpenAIEmbeddings;
  private llmFast: ChatOpenAI;    // For quick tasks (rephrasing)
  private llmStrong: ChatOpenAI;  // For medical answers (requires nuance)
  private cohere: CohereClientV2 | null = null;

  constructor() {
    // Initialize Supabase client
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Initialize OpenAI embeddings
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    // Fast model for rephrasing queries (cheap, quick)
    this.llmFast = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: 'gpt-4o-mini',
      temperature: 0.2,
    });

    // Strong model for medical answers (nuanced, follows complex instructions)
    this.llmStrong = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: 'gpt-4o',
      temperature: 0.3,
    });

    // Initialize Cohere for reranking (optional)
    if (COHERE_ENABLED) {
      this.cohere = new CohereClientV2({
        token: process.env.COHERE_API_KEY!,
      });
      console.log('✅ Cohere reranking enabled');
    } else {
      console.log('⚠️ Cohere API key not found, reranking disabled');
    }
  }

  /**
   * Sleep for a specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Rephrase a follow-up question into a standalone question using conversation history.
   */
  private async contextualizeQuery(query: string, history: ChatMessage[]): Promise<string> {
    if (!history || history.length === 0) {
      return query;
    }

    const formattedHistory = history
      .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');

    const prompt = REPHRASE_PROMPT
      .replace('{history}', formattedHistory)
      .replace('{question}', query);

    try {
      const response = await this.llmFast.invoke([
        new HumanMessage(prompt),
      ]);

      const rephrased = (response.content as string).trim();
      
      console.log(`🔄 Query rephrasing:`);
      console.log(`   Original: "${query}"`);
      console.log(`   Rephrased: "${rephrased}"`);
      
      return rephrased;
    } catch (error) {
      console.warn('⚠️ Failed to rephrase query, using original:', error);
      return query;
    }
  }

  /**
   * Translate query to English for better embedding matching.
   * Our knowledge base is in English, so translating improves semantic search.
   * Also expands query with medical synonyms for better retrieval.
   */
  private async translateToEnglish(query: string): Promise<string> {
    const prompt = `You are a medical search query optimizer. Your task is to translate and EXPAND the following pediatric question for searching a medical knowledge base.

INSTRUCTIONS:
1. Translate to English
2. Add relevant medical synonyms and related terms
3. If the query mentions "heels falling inward" or similar → add "flat feet", "fallen arches", "pes planus"
4. If the query mentions "brittle/thin nails" → add "soft pliable toenails", "nail care"
5. Keep it as a search query (keywords), not a full sentence
6. Output ONLY the expanded English query, nothing else

Question: ${query}

Expanded English search query:`;

    try {
      const response = await this.llmFast.invoke([
        new HumanMessage(prompt),
      ]);

      const translated = (response.content as string).trim();
      console.log(`🌐 Query translation for embedding:`);
      console.log(`   Original: "${query.substring(0, 80)}..."`);
      console.log(`   English: "${translated.substring(0, 80)}..."`);
      
      return translated;
    } catch (error) {
      console.warn('⚠️ Failed to translate query, using original:', error);
      return query;
    }
  }

  /**
   * Extract age in months from query text (Ukrainian/Russian)
   * Returns null if no age found
   */
  extractAgeFromQuery(query: string): { ageMonths: number; ageText: string } | null {
    // Normalize text
    const text = query.toLowerCase();
    
    // Pattern 1: "X років/рік/роки/год/лет" (years)
    const yearsPatterns = [
      /(\d+)[\s-]*(річн|рочн|років|роки|рік|год(?:а|ов)?|лет|года)/i,
      /дитин[аіиі]?\s+(\d+)\s*(років|роки|рік|год|лет)/i,
    ];
    
    for (const pattern of yearsPatterns) {
      const match = text.match(pattern);
      if (match) {
        const years = parseInt(match[1], 10);
        if (years >= 0 && years <= 18) {
          return { ageMonths: years * 12, ageText: match[0] };
        }
      }
    }
    
    // Pattern 2: "X місяців/міс/месяцев" (months)
    const monthsPatterns = [
      /(\d+)[\s-]*(місяц|місяч|міс(?:\.)?|месяц|мес(?:\.|яц)?)/i,
      /дитин[аіиі]?\s+(\d+)\s*(місяц|міс|месяц)/i,
    ];
    
    for (const pattern of monthsPatterns) {
      const match = text.match(pattern);
      if (match) {
        const months = parseInt(match[1], 10);
        if (months >= 0 && months <= 216) {
          return { ageMonths: months, ageText: match[0] };
        }
      }
    }
    
    // Pattern 3: "X тижнів/неделя/недель" (weeks)
    const weeksPatterns = [
      /(\d+)[\s-]*(тижн|тижд|недел|неділ)/i,
    ];
    
    for (const pattern of weeksPatterns) {
      const match = text.match(pattern);
      if (match) {
        const weeks = parseInt(match[1], 10);
        if (weeks >= 0 && weeks <= 52) {
          const months = Math.round(weeks / 4.33);
          return { ageMonths: months, ageText: match[0] };
        }
      }
    }
    
    // Pattern 4: "X днів/дней" (days) - for newborns
    const daysPatterns = [
      /(\d+)[\s-]*(днів|дні|день|дней)/i,
    ];
    
    for (const pattern of daysPatterns) {
      const match = text.match(pattern);
      if (match) {
        const days = parseInt(match[1], 10);
        if (days >= 0 && days <= 365) {
          const months = Math.round(days / 30);
          return { ageMonths: months, ageText: match[0] };
        }
      }
    }
    
    // Pattern 5: Special keywords
    const keywords: Record<string, number> = {
      'новонародж': 0,
      'новорожд': 0,
      'немовля': 3,
      'младенец': 3,
      'грудничок': 3,
      'грудничк': 3,
      'малюк': 12,
      'малыш': 12,
      'дошкільн': 48,
      'дошкольн': 48,
    };
    
    for (const [keyword, months] of Object.entries(keywords)) {
      if (text.includes(keyword)) {
        return { ageMonths: months, ageText: keyword };
      }
    }
    
    return null;
  }

  /**
   * Check if a query likely requires age-specific advice
   */
  queryRequiresAge(query: string): boolean {
    const ageRequiredPatterns = [
      /норм(а|ально|альн)/i,         // "це нормально?"
      /розвит(ок|ку)/i,              // "розвиток"
      /milestone/i,
      /дозуванн|доз(а|и|у)/i,        // "дозування"
      /годуванн|кормлен/i,           // "годування"
      /прикорм/i,                    // "прикорм"
      /сон|спати|спить/i,            // "сон"
      /вага|вес|набира/i,            // "вага"
      /зріст|рост|рості/i,           // "зріст"
      /ходи(ти|ть)|хід/i,            // "ходити"
      /говори(ти|ть)|мовленн/i,      // "говорити"
      /зуб(и|ів|ок|чик)/i,           // "зуби"
      /повзати|повзає/i,             // "повзати"
      /сід(ати|ає|іти)/i,            // "сідати"
    ];
    
    return ageRequiredPatterns.some(pattern => pattern.test(query));
  }

  /**
   * Get age category from months
   */
  private getAgeCategory(ageMonths?: number): keyof typeof AGE_CONTEXTS {
    if (ageMonths === undefined || ageMonths === null) return 'unknown';
    if (ageMonths < 3) return 'newborn';
    if (ageMonths < 12) return 'infant';
    if (ageMonths < 36) return 'toddler';
    if (ageMonths < 72) return 'preschool';
    return 'child';
  }

  /**
   * Filter results by age appropriateness
   */
  private filterByAge(results: MatchResult[], ageMonths?: number): MatchResult[] {
    if (ageMonths === undefined || ageMonths === null) {
      return results;
    }

    return results.filter((result) => {
      const minAge = (result.metadata?.age_min_months as number) ?? 0;
      const maxAge = (result.metadata?.age_max_months as number) ?? 216;
      
      // Include if child's age is within source's age range
      // Allow some flexibility: include sources that are ±3 months outside range
      const adjustedAge = ageMonths;
      return adjustedAge >= minAge - 3 && adjustedAge <= maxAge + 3;
    });
  }

  /**
   * Sort results by reliability score and language preference
   * Higher reliability = better, same language as query = better
   */
  private sortByReliabilityAndLanguage(
    results: MatchResult[],
    userLanguage: string
  ): MatchResult[] {
    return [...results].sort((a, b) => {
      const reliabilityA = (a.metadata?.reliability as number) ?? 3;
      const reliabilityB = (b.metadata?.reliability as number) ?? 3;
      
      const langA = (a.metadata?.language as string) ?? 'en';
      const langB = (b.metadata?.language as string) ?? 'en';
      
      // Language bonus: +1 reliability if source matches user language
      const effectiveRelA = reliabilityA + (langA === userLanguage ? 0.5 : 0);
      const effectiveRelB = reliabilityB + (langB === userLanguage ? 0.5 : 0);
      
      return effectiveRelB - effectiveRelA; // Descending
    });
  }

  /**
   * Rerank results using Cohere
   */
  private async rerank(query: string, results: MatchResult[]): Promise<MatchResult[]> {
    if (!this.cohere || results.length === 0) {
      return results;
    }

    try {
      console.log(`🔄 Reranking ${results.length} results with Cohere...`);

      const documents = results.map((r) => r.content);

      const response = await this.cohere.rerank({
        model: 'rerank-v3.5',
        query,
        documents,
        topN: Math.min(15, results.length),
      });

      // Map reranked results back to original format
      const rerankedResults = response.results.map((r) => ({
        ...results[r.index],
        similarity: r.relevanceScore, // Update similarity with rerank score
      }));

      console.log(`✅ Reranking complete. Top score: ${rerankedResults[0]?.similarity.toFixed(3)}`);

      return rerankedResults;
    } catch (error) {
      console.warn('⚠️ Cohere reranking failed, using original order:', error);
      return results;
    }
  }

  /**
   * Query the knowledge base and generate an answer with retry logic.
   */
  async answerQuery(
    query: string,
    language: string = 'en',
    history: ChatMessage[] = [],
    ageMonths?: number
  ): Promise<RagResult> {
    const startTime = Date.now();
    let lastError: Error | null = null;
    let rephrasedQuery = query;

    // Get age category for safety prompts
    const ageCategory = this.getAgeCategory(ageMonths);
    console.log(`👶 Age category: ${ageCategory} (${ageMonths ?? 'unknown'} months)`);

    // Retry loop
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Step 1: Contextualize the query using conversation history
        rephrasedQuery = await this.contextualizeQuery(query, history);

        // Step 2: Translate query to English for better embedding matching
        // (Our knowledge base is in English)
        const englishQuery = await this.translateToEnglish(rephrasedQuery);

        // Step 3: Generate embedding for the English query
        const queryEmbedding = await this.embeddings.embedQuery(englishQuery);

        // Step 4: Search for relevant documents via Supabase RPC
        const fetchCount = COHERE_ENABLED ? INITIAL_FETCH_COUNT : FINAL_CONTEXT_COUNT;
        
        const { data: matches, error } = await this.supabase.rpc('match_medical_knowledge', {
          query_embedding: queryEmbedding,
          match_count: fetchCount,
          filter: {},
        });

        if (error) {
          console.error('Supabase RPC error:', error);
          throw new Error(`Failed to search knowledge base: ${error.message}`);
        }

        let results = (matches || []) as MatchResult[];
        console.log(`\n📚 Initial vector search: ${results.length} results`);

        // Step 5: Filter by age FIRST (before Cohere to save API calls)
        let ageFilteredResults = this.filterByAge(results, ageMonths);
        console.log(`🎯 After age filter: ${ageFilteredResults.length} results`);

        // Step 6: Choose processing path based on Cohere availability
        let finalResults: MatchResult[];

        if (COHERE_ENABLED && ageFilteredResults.length > 0) {
          // Cohere path: rerank using ENGLISH query for better matching
          const reranked = await this.rerank(englishQuery, ageFilteredResults);
          finalResults = reranked.slice(0, FINAL_CONTEXT_COUNT);
        } else {
          // No Cohere: sort by reliability + language → slice
          finalResults = this.sortByReliabilityAndLanguage(ageFilteredResults, language)
            .slice(0, FINAL_CONTEXT_COUNT);
        }

        console.log(`✅ Final results: ${finalResults.length}`);

        // Log final sources with content preview
        console.log('\n📚 Sources for context:');
        finalResults.forEach((match, index) => {
          const filename = match.metadata?.filename || 'Unknown';
          const reliability = match.metadata?.reliability || '?';
          const contentPreview = match.content.substring(0, 150).replace(/\n/g, ' ').trim();
          console.log(`  ${index + 1}. ${filename} (sim: ${match.similarity.toFixed(3)}, rel: ${reliability})`);
          console.log(`     📄 "${contentPreview}..."`);
        });

        // Step 7: Build context from retrieved documents
        const context = finalResults
          .map((match) => match.content)
          .join('\n\n---\n\n');

        // Step 8: Generate answer using LLM with age-aware system prompt
        const answer = await this.generateAnswer(query, context, language, ageCategory);

        // Build sources array
        const sources: RagSource[] = finalResults.map((match) => ({
          filename: (match.metadata?.filename as string) || 'Unknown',
          similarity: match.similarity,
          metadata: match.metadata,
        }));

        const processingTimeMs = Date.now() - startTime;
        console.log(`⏱ Processing time: ${processingTimeMs}ms`);

        return {
          answer,
          sources,
          processingTimeMs,
          rephrasedQuery,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < MAX_RETRIES) {
          const delayMs = BASE_DELAY_MS * attempt;
          console.warn(`\n⚠️ Attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.message}`);
          console.warn(`   Retrying in ${delayMs}ms...`);
          await this.sleep(delayMs);
        }
      }
    }

    // All retries exhausted
    const processingTimeMs = Date.now() - startTime;
    console.error(`\n❌ All ${MAX_RETRIES} attempts failed. Last error:`, lastError?.message);

    return {
      answer: 'Вибачте, зараз проводяться технічні роботи на сервері бази даних. Будь ласка, повторіть запитання через 2-3 хвилини.',
      sources: [],
      processingTimeMs,
      rephrasedQuery,
    };
  }

  /**
   * Log user interaction to the request_logs table.
   */
  async logInteraction(data: LogInteractionData): Promise<void> {
    try {
      const { error } = await this.supabase.from('request_logs').insert({
        user_id: data.user_id,
        username: data.username || null,
        first_name: data.first_name,
        original_question: data.original_question,
        rephrased_question: data.rephrased_question,
        bot_answer: data.bot_answer,
        sources: data.sources,
        duration_ms: data.duration_ms,
        child_age_months: data.child_age_months ?? null,
        created_at: new Date().toISOString(),
      });

      if (error) {
        console.error('❌ Failed to log interaction:', error.message);
      } else {
        console.log('📝 Interaction logged successfully');
      }
    } catch (error) {
      console.error('❌ Error logging interaction:', error);
    }
  }

  /**
   * Generate an answer using the LLM with the retrieved context.
   */
  private async generateAnswer(
    query: string,
    context: string,
    language: string,
    ageCategory: keyof typeof AGE_CONTEXTS
  ): Promise<string> {
    // If no context found, return a helpful message
    if (!context.trim()) {
      if (language === 'ru' || language === 'uk') {
        return 'На жаль, я не знайшов інформації за вашим запитом у своїй базі знань. Рекомендую звернутися до педіатра для отримання кваліфікованої консультації. 🩺';
      }
      return 'Unfortunately, I could not find information about your question in my knowledge base. I recommend consulting a pediatrician for qualified advice. 🩺';
    }

    // Build the system prompt with age context
    const ageContext = AGE_CONTEXTS[ageCategory];
    const systemPrompt = SYSTEM_PROMPT.replace('{age_context}', ageContext);

    const userPrompt = `CONTEXT FROM MEDICAL LITERATURE:
${context}

---

USER QUESTION: ${query}

CHILD AGE: ${ageCategory}

---

GENERATION INSTRUCTIONS:

1. **START WITH GREETING:** "Доброго дня/вечора. Грунтуючись на рекомендаціях AAP, ось інформація щодо вашої ситуації з дитиною [вік]."

2. **FOLLOW QUESTION STRUCTURE:** If user asks about multiple topics (nails + feet), create separate "Щодо [topic]" sections IN THE SAME ORDER as asked.

3. **FOR EACH TOPIC:**
   - First sentence = VERDICT (Is this normal? Be direct.)
   - Then bullet points (•) explaining WHY this happens (biological mechanism), timeline, what NOT to worry about.

4. **EXTRACT, DON'T SUMMARIZE (CRITICAL!):**
   - If CONTEXT has TIMING (e.g., "15-20 min before feeding") → INCLUDE IT: "за 15-20 хв до годування"
   - If CONTEXT has FREQUENCY (e.g., "no more than 3 times a day") → INCLUDE IT: "не частіше 3 разів на день"
   - If CONTEXT has QUANTITIES (e.g., "1-2 drops") → INCLUDE IT: "1-2 краплі"
   - If CONTEXT has WARNINGS (e.g., "hot steam dangerous") → INCLUDE IT: "⚠️ Гарячий пар небезпечний!"
   - If CONTEXT has TECHNIQUE details → INCLUDE THEM step by step

5. **DIFFERENTIAL DIAGNOSIS (for "Could this be X?" questions):**
   - If user asks if symptoms could be GERD/reflux AND mentions "no symptoms at night":
     → You MUST say: "Аргументи ПРОТИ ГЕРХ: рефлюкс зазвичай посилюється вночі. Відсутність симптомів вночі робить ГЕРХ менш імовірним."
   - If symptoms are repetitive (every few seconds) + absent during sleep + child age 3-8:
     → Consider mentioning: "Альтернатива: вокальні тики можуть мати подібний прояв і зникають під час сну."
   - Always provide "Аргументи ЗА" and "Аргументи ПРОТИ" for suspected diagnoses

6. **ALWAYS INCLUDE "Чи потрібен огляд спеціаліста?" SECTION:**
   - List relevant specialists (Ортопед, Дерматолог, etc.)
   - For each: when NOT needed + when IS needed (specific warning signs)

7. **END WITH "Рекомендація:"** — concrete actionable next step (e.g., show to pediatrician, what shoes to buy).

8. **SAFETY:**
   - Use ONLY information from CONTEXT. Do NOT add external medical knowledge.
   - If context mentions advice for OLDER children, DO NOT apply it to ${ageCategory}.
   - For saline — recommend ONLY pharmacy saline (фізрозчин), NEVER homemade recipes.

9. **LANGUAGE:** Answer in the user's language (Ukrainian or Russian).`;

    const response = await this.llmStrong.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    return response.content as string;
  }
}

// Singleton instance
let ragServiceInstance: RagService | null = null;

/**
 * Get the singleton RagService instance.
 */
export function getRagService(): RagService {
  if (!ragServiceInstance) {
    ragServiceInstance = new RagService();
  }
  return ragServiceInstance;
}
