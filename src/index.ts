import 'dotenv/config';
import { createBot } from './bot/index.js';

/**
 * Validate required environment variables.
 */
function validateEnv(): void {
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'OPENAI_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach((key) => console.error(`   - ${key}`));
    process.exit(1);
  }

  // Warn if ADMIN_ID is not set
  if (!process.env.ADMIN_ID) {
    console.warn('⚠️  ADMIN_ID not set. Debug mode will be unavailable.');
  }
}

/**
 * Main entry point.
 */
async function main() {
  console.log('🚀 Starting BabyDoc Bot...\n');

  // Validate environment
  validateEnv();

  // Create and launch bot
  const bot = createBot();

  // Enable graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n📴 Received ${signal}. Shutting down gracefully...`);
    bot.stop(signal);
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  // Launch bot
  try {
    await bot.launch();
    console.log('✅ Bot is running!');
    console.log('📱 Send a message to your bot on Telegram to start.\n');
    
    // Log admin status
    if (process.env.ADMIN_ID) {
      console.log(`👑 Admin ID: ${process.env.ADMIN_ID}`);
      console.log('   Use /debug command to toggle debug mode.\n');
    }
  } catch (error) {
    console.error('❌ Failed to launch bot:', error);
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
