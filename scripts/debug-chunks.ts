import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function searchChunks(searchTerms: string[]) {
  console.log('🔍 Searching for chunks in Supabase...\n');

  for (const term of searchTerms) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔎 Searching for: "${term}"`);
    console.log('='.repeat(60));

    // Search using ILIKE for case-insensitive partial match
    const { data, error } = await supabase
      .from('medical_knowledge')
      .select('id, content, metadata')
      .ilike('content', `%${term}%`)
      .limit(5);

    if (error) {
      console.error(`❌ Error: ${error.message}`);
      continue;
    }

    if (!data || data.length === 0) {
      console.log(`❌ No chunks found containing "${term}"`);
      continue;
    }

    console.log(`✅ Found ${data.length} chunk(s):\n`);

    data.forEach((chunk, index) => {
      const preview = chunk.content.substring(0, 300).replace(/\n/g, ' ');
      const filename = chunk.metadata?.filename || 'Unknown';
      const section = chunk.metadata?.section || 'N/A';
      
      console.log(`--- Chunk ${index + 1} ---`);
      console.log(`📄 File: ${filename}`);
      console.log(`📑 Section: ${section}`);
      console.log(`📝 Preview: "${preview}..."`);
      console.log();
    });
  }
}

// Search for specific terms we expect to find
const searchTerms = [
  'flat feet',
  'fallen arches',
  'fat pad',
  'toenail',
  'soft and pliable',
  'shoe inserts',
];

searchChunks(searchTerms).then(() => {
  console.log('\n✅ Search complete');
  process.exit(0);
}).catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
