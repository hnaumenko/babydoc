import { Telegraf, Context } from 'telegraf';
import LocalSession from 'telegraf-session-local';
import { getRagService, RagResult, ChatMessage } from '../services/rag.js';
import { getUserService, User, AgeInfo } from '../services/user.js';

// Configuration
const MAX_HISTORY_MESSAGES = 10;
const HISTORY_FOR_CONTEXT = 6;

// FSM States for onboarding
type FSMState = 'idle' | 'awaiting_birth_date' | 'awaiting_child_name';

// Session data interface (only for temporary state, NOT for persistent data)
interface SessionData {
  debugMode?: boolean;
  messages: ChatMessage[];
  fsmState: FSMState;
}

// Extended context with session and user
interface BotContext extends Context {
  session: SessionData;
  user?: User | null;
  ageInfo?: AgeInfo | null;
}

// Get admin ID from environment
const ADMIN_ID = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID, 10) : null;

/**
 * Check if the user is an admin.
 */
function isAdmin(ctx: BotContext): boolean {
  return ADMIN_ID !== null && ctx.from?.id === ADMIN_ID;
}

/**
 * Format debug information message.
 */
function formatDebugMessage(result: RagResult, ageInfo?: AgeInfo | null): string {
  const processingTime = (result.processingTimeMs / 1000).toFixed(2);
  
  let message = `🔧 *Debug Info:*\n`;
  message += `⏱ Processing time: ${processingTime}s\n`;
  
  if (ageInfo) {
    message += `👶 Age: ${ageInfo.ageMonths} months \\(${ageInfo.ageCategory}\\)\n`;
  }
  
  if (result.rephrasedQuery && result.rephrasedQuery !== result.answer) {
    message += `🔄 Rephrased: ${escapeMarkdown(result.rephrasedQuery)}\n`;
  }
  
  message += `\n📚 *Sources used:*\n`;
  
  if (result.sources.length === 0) {
    message += `  _No sources found_\n`;
  } else {
    result.sources.forEach((source, index) => {
      const similarity = (source.similarity * 100).toFixed(1);
      const reliability = source.metadata?.reliability || '?';
      message += `  ${index + 1}\\. \`${escapeMarkdown(source.filename)}\`\n`;
      message += `     Sim: ${similarity}% \\| Rel: ${reliability}/5\n`;
    });
  }
  
  return message;
}

/**
 * Escape special characters for Telegram MarkdownV2.
 * Must escape: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * Also escape ? and ' to avoid parsing issues with Ukrainian text.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!?']/g, '\\$&');
}

/**
 * Create and configure the Telegraf bot.
 */
export function createBot(): Telegraf<BotContext> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  const bot = new Telegraf<BotContext>(token);
  const userService = getUserService();

  // Initialize local session storage (for temporary state only)
  const localSession = new LocalSession({
    database: 'sessions.json',
    property: 'session',
    storage: LocalSession.storageFileAsync,
    format: {
      serialize: (obj) => JSON.stringify(obj, null, 2),
      deserialize: (str) => JSON.parse(str),
    },
    state: {
      messages: [] as ChatMessage[],
      fsmState: 'idle' as FSMState,
    },
  });

  bot.use(localSession.middleware());
  
  // Ensure session defaults (for existing sessions)
  bot.use((ctx, next) => {
    if (!ctx.session.messages) {
      ctx.session.messages = [];
    }
    if (!ctx.session.fsmState) {
      ctx.session.fsmState = 'idle';
    }
    return next();
  });

  // User middleware: load user from database
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      ctx.user = await userService.getOrCreateUser({
        telegram_id: ctx.from.id,
        username: ctx.from.username,
        first_name: ctx.from.first_name,
      });

      // Calculate age info if child birth date is set
      if (ctx.user?.child_birth_date) {
        ctx.ageInfo = userService.getAgeInfo(ctx.user.child_birth_date);
      }
    }
    return next();
  });

  // /start command
  bot.command('start', async (ctx) => {
    const firstName = ctx.from?.first_name || 'там';
    
    // Clear conversation history on start
    ctx.session.messages = [];
    ctx.session.fsmState = 'idle';
    
    // Check if user has child birth date set
    if (!ctx.user?.child_birth_date) {
      await ctx.reply(
        `👋 Привіт, ${firstName}!\n\n` +
        `Я *BabyDoc* — ваш помічник з питань догляду за немовлятами та дітьми.\n\n` +
        `📅 *Опціонально:* Введіть дату народження дитини (ДД.ММ.РРРР), щоб я давав точніші поради.\n\n` +
        `💬 Або просто задайте питання — вказуйте вік у тексті:\n` +
        `_"Мій 3-річний син..." або "Дитині 6 місяців..."_\n\n` +
        `⚠️ _Пам'ятайте: я не замінюю консультацію лікаря._`,
        { parse_mode: 'Markdown' }
      );
    } else {
      const ageFormatted = userService.formatAge(ctx.ageInfo!.ageMonths);
      const childName = ctx.user.child_name ? `${ctx.user.child_name} (${ageFormatted})` : ageFormatted;
      
      await ctx.reply(
        `👋 З поверненням, ${firstName}!\n\n` +
        `Я пам'ятаю, що вашій дитині ${childName}.\n\n` +
        `Задайте мені будь-яке питання про здоров'я та розвиток вашої дитини!\n\n` +
        `💡 _Команда /baby — змінити дані дитини_\n` +
        `⚠️ _Пам'ятайте: я не замінюю консультацію лікаря._`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // /baby command - view/edit child info
  bot.command('baby', async (ctx) => {
    if (!ctx.user?.child_birth_date) {
      ctx.session.fsmState = 'awaiting_birth_date';
      await ctx.reply(
        `👶 Дані про дитину ще не внесені.\n\n` +
        `📅 *Введіть дату народження дитини* у форматі ДД.ММ.РРРР\n` +
        `(наприклад: 15.03.2024)`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const ageFormatted = userService.formatAge(ctx.ageInfo!.ageMonths);
    const childName = ctx.user.child_name || 'Не вказано';
    const birthDate = new Date(ctx.user.child_birth_date).toLocaleDateString('uk-UA');

    await ctx.reply(
      `👶 *Дані про дитину:*\n\n` +
      `📛 Ім'я: ${childName}\n` +
      `📅 Дата народження: ${birthDate}\n` +
      `🎂 Вік: ${ageFormatted}\n` +
      `📊 Категорія: ${ctx.ageInfo!.ageLabel}\n\n` +
      `_Щоб змінити дату, введіть нову у форматі ДД.ММ.РРРР_`,
      { parse_mode: 'Markdown' }
    );
    
    ctx.session.fsmState = 'awaiting_birth_date';
  });

  // /clear command - reset conversation history
  bot.command('clear', async (ctx) => {
    ctx.session.messages = [];
    await ctx.reply('🗑 Історію розмови очищено. Можемо почати з чистого аркуша!');
  });

  // /debug command (admin only)
  bot.command('debug', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply('⛔ Ця команда доступна тільки адміністраторам.');
      return;
    }

    ctx.session.debugMode = !ctx.session.debugMode;
    const status = ctx.session.debugMode ? 'ON ✅' : 'OFF ❌';
    await ctx.reply(`🔧 Debug mode: ${status}`);
  });

  // /help command
  bot.command('help', async (ctx) => {
    let helpText = `🤖 *Доступні команди:*\n\n` +
      `/start - Почати роботу з ботом\n` +
      `/baby - Переглянути/змінити дані дитини\n` +
      `/clear - Очистити історію розмови\n` +
      `/help - Показати це повідомлення\n`;
    
    if (isAdmin(ctx)) {
      helpText += `/debug - Увімкнути/вимкнути режим налагодження\n`;
    }
    
    helpText += `\n💬 Просто напишіть своє питання, і я постараюся допомогти!\n`;
    helpText += `\n💡 _Бот пам'ятає контекст розмови і вік дитини._`;
    
    await ctx.reply(helpText, { parse_mode: 'Markdown' });
  });

  // Message handler for questions
  bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    
    // Skip if it's a command
    if (text.startsWith('/')) {
      return;
    }

    // Try to parse as birth date if it looks like one (DD.MM.YYYY format)
    const looksLikeDate = /^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}$/.test(text.trim());
    
    if (looksLikeDate) {
      const parsedDate = userService.parseDate(text);
      
      if (parsedDate) {
        const validation = userService.validateBirthDate(parsedDate);
        if (validation.valid) {
          // Save birth date to database
          const updatedUser = await userService.updateChildBirthDate(
            ctx.from!.id,
            parsedDate
          );

          if (updatedUser) {
            ctx.user = updatedUser;
            ctx.ageInfo = userService.getAgeInfo(parsedDate);
            
            const ageFormatted = userService.formatAge(ctx.ageInfo.ageMonths);
            ctx.session.fsmState = 'idle';

            await ctx.reply(
              `✅ Чудово! Я запам'ятав, що вашій дитині ${ageFormatted}.\n\n` +
              `Тепер я зможу давати вам поради, враховуючи вік дитини.\n\n` +
              `💬 Задавайте будь-які питання про здоров'я та розвиток!`,
              { parse_mode: 'Markdown' }
            );
            return;
          }
        } else {
          await ctx.reply(`❌ ${validation.error}`);
          return;
        }
      }
    }

    // Reset FSM state if we're processing a question
    ctx.session.fsmState = 'idle';

    // Process regular question
    const query = text;
    const userId = ctx.from?.id;
    const username = ctx.from?.username || ctx.from?.first_name || 'Unknown';

    // Get RAG service and detect language
    const ragService = getRagService();
    const hasCyrillic = /[а-яА-ЯіІїЇєЄґҐ]/.test(query);
    const language = hasCyrillic ? 'uk' : 'en';

    // Determine child's age: from profile OR from query text
    let ageMonths: number | undefined = ctx.ageInfo?.ageMonths;
    let ageSource: string = 'profile';
    
    if (!ageMonths) {
      // Try to extract age from query
      const extractedAge = ragService.extractAgeFromQuery(query);
      if (extractedAge) {
        ageMonths = extractedAge.ageMonths;
        ageSource = `query ("${extractedAge.ageText}")`;
      }
    }
    
    // If age is still unknown and query requires it, ask for age
    if (!ageMonths && ragService.queryRequiresAge(query)) {
      await ctx.reply(
        `❓ Щоб дати точну відповідь, підкажіть, скільки місяців/років вашій дитині?\n\n` +
        `💡 _Ви також можете вказати вік у питанні: "Мій 2-річний син..." або ввести дату народження (ДД.ММ.РРРР)_`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`📩 Incoming message from ${username} (ID: ${userId})`);
    console.log(`💬 Query: "${query}"`);
    if (ageMonths !== undefined) {
      console.log(`👶 Child age: ${ageMonths} months (source: ${ageSource})`);
    } else {
      console.log(`👶 Child age: unknown`);
    }
    console.log('='.repeat(60));
    
    console.log(`🌐 Detected language: ${language}`);
    console.log(`💬 History messages: ${ctx.session.messages.length}`);

    // Get conversation history for contextualizing
    const historyForContext = ctx.session.messages.slice(-HISTORY_FOR_CONTEXT);

    // Send loading message
    const loadingMessage = await ctx.reply('⏳ Шукаю інформацію в медичних джерелах...');

    // Start continuous typing indicator
    await ctx.sendChatAction('typing');
    const typingInterval = setInterval(() => {
      ctx.sendChatAction('typing').catch(() => {});
    }, 4000);

    try {
      // Pass age info to RAG service (from profile or extracted from query)
      const result = await ragService.answerQuery(
        query,
        language,
        historyForContext,
        ageMonths
      );

      console.log(`\n✅ Response generated:`);
      console.log(`   ⏱ Processing time: ${result.processingTimeMs}ms`);
      console.log(`   📚 Sources: ${result.sources.length}`);
      console.log(`   📝 Answer length: ${result.answer.length} chars`);

      // Store messages in session (sliding window)
      ctx.session.messages.push(
        { role: 'user', content: query },
        { role: 'assistant', content: result.answer }
      );
      
      if (ctx.session.messages.length > MAX_HISTORY_MESSAGES) {
        ctx.session.messages = ctx.session.messages.slice(-MAX_HISTORY_MESSAGES);
      }

      // Delete loading message and send the answer
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id).catch(() => {});
      await ctx.reply(result.answer);

      // Send debug info if enabled (admin only)
      if (ctx.session.debugMode && isAdmin(ctx)) {
        // Create age info for debug (from profile or extracted)
        const debugAgeInfo = ageMonths !== undefined 
          ? { ageMonths, ageCategory: ragService.extractAgeFromQuery(query) ? 'extracted' : ctx.ageInfo?.ageCategory || 'unknown', ageLabel: `${ageMonths} months` }
          : null;
        const debugMessage = formatDebugMessage(result, debugAgeInfo as AgeInfo | null);
        // Use try-catch to handle MarkdownV2 escaping issues with Ukrainian text
        try {
          await ctx.reply(debugMessage, { parse_mode: 'MarkdownV2' });
        } catch {
          // Fallback to plain text if escaping fails
          await ctx.reply(debugMessage.replace(/\\/g, ''));
        }
      }

      // Log interaction to database (fire-and-forget)
      ragService.logInteraction({
        user_id: ctx.from?.id ?? 0,
        username: ctx.from?.username,
        first_name: ctx.from?.first_name ?? 'Unknown',
        original_question: query,
        rephrased_question: result.rephrasedQuery,
        bot_answer: result.answer,
        sources: result.sources,
        duration_ms: result.processingTimeMs,
        child_age_months: ageMonths, // Use the determined age (from profile or extracted)
      }).catch((err) => console.error('Failed to log interaction:', err));
    } catch (error) {
      console.error('\n❌ Error handling message:', error);
      
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id).catch(() => {});
      await ctx.reply(
        '😔 Вибачте, сталася помилка при обробці вашого запиту. ' +
        'Спробуйте ще раз пізніше або зверніться до лікаря.'
      );
    } finally {
      clearInterval(typingInterval);
    }
  });

  // Error handler
  bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ctx.reply('Виникла непередбачена помилка. Спробуйте пізніше.').catch(() => {});
  });

  return bot;
}
