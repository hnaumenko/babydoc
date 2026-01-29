import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Types
export interface User {
  id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  child_birth_date: string | null;
  child_name: string | null;
  language: string;
  created_at: string;
  updated_at: string;
}

export interface CreateUserData {
  telegram_id: number;
  username?: string;
  first_name?: string;
  language?: string;
}

export interface AgeInfo {
  ageMonths: number;
  ageCategory: 'newborn' | 'infant' | 'toddler' | 'preschool' | 'child';
  ageLabel: string;
}

// Age category definitions
const AGE_CATEGORIES = {
  newborn: { min: 0, max: 3, label: 'Новонароджений (0-3 міс)' },
  infant: { min: 3, max: 12, label: 'Немовля (3-12 міс)' },
  toddler: { min: 12, max: 36, label: 'Тоддлер (1-3 роки)' },
  preschool: { min: 36, max: 72, label: 'Дошкільник (3-6 років)' },
  child: { min: 72, max: 216, label: 'Дитина (6-18 років)' },
} as const;

/**
 * User Service for managing user data in Supabase
 */
export class UserService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }

  /**
   * Get user by Telegram ID
   */
  async getUser(telegramId: number): Promise<User | null> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned - user doesn't exist
        return null;
      }
      console.error('Error fetching user:', error);
      return null;
    }

    return data as User;
  }

  /**
   * Create a new user
   */
  async createUser(data: CreateUserData): Promise<User | null> {
    const { data: user, error } = await this.supabase
      .from('users')
      .insert({
        telegram_id: data.telegram_id,
        username: data.username || null,
        first_name: data.first_name || null,
        language: data.language || 'uk',
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating user:', error);
      return null;
    }

    return user as User;
  }

  /**
   * Get or create user
   */
  async getOrCreateUser(data: CreateUserData): Promise<User | null> {
    let user = await this.getUser(data.telegram_id);
    
    if (!user) {
      user = await this.createUser(data);
    }

    return user;
  }

  /**
   * Update child birth date
   */
  async updateChildBirthDate(
    telegramId: number,
    birthDate: string,
    childName?: string
  ): Promise<User | null> {
    const updateData: Record<string, any> = {
      child_birth_date: birthDate,
    };

    if (childName) {
      updateData.child_name = childName;
    }

    const { data, error } = await this.supabase
      .from('users')
      .update(updateData)
      .eq('telegram_id', telegramId)
      .select()
      .single();

    if (error) {
      console.error('Error updating child birth date:', error);
      return null;
    }

    return data as User;
  }

  /**
   * Update user language
   */
  async updateLanguage(telegramId: number, language: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from('users')
      .update({ language })
      .eq('telegram_id', telegramId)
      .select()
      .single();

    if (error) {
      console.error('Error updating language:', error);
      return null;
    }

    return data as User;
  }

  /**
   * Calculate age in months from birth date
   */
  calculateAgeMonths(birthDate: string): number {
    const birth = new Date(birthDate);
    const now = new Date();
    
    const months = (now.getFullYear() - birth.getFullYear()) * 12 +
                   (now.getMonth() - birth.getMonth());
    
    // Adjust if birth day hasn't occurred this month yet
    if (now.getDate() < birth.getDate()) {
      return Math.max(0, months - 1);
    }
    
    return Math.max(0, months);
  }

  /**
   * Get age category from months
   */
  getAgeCategory(ageMonths: number): AgeInfo['ageCategory'] {
    for (const [category, range] of Object.entries(AGE_CATEGORIES)) {
      if (ageMonths >= range.min && ageMonths < range.max) {
        return category as AgeInfo['ageCategory'];
      }
    }
    return 'child';
  }

  /**
   * Get full age info from birth date
   */
  getAgeInfo(birthDate: string): AgeInfo {
    const ageMonths = this.calculateAgeMonths(birthDate);
    const ageCategory = this.getAgeCategory(ageMonths);
    const ageLabel = AGE_CATEGORIES[ageCategory].label;

    return { ageMonths, ageCategory, ageLabel };
  }

  /**
   * Format age for display
   */
  formatAge(ageMonths: number): string {
    if (ageMonths < 1) {
      return 'менше 1 місяця';
    } else if (ageMonths < 12) {
      const monthWord = this.getMonthWord(ageMonths);
      return `${ageMonths} ${monthWord}`;
    } else {
      const years = Math.floor(ageMonths / 12);
      const months = ageMonths % 12;
      const yearWord = this.getYearWord(years);
      
      if (months === 0) {
        return `${years} ${yearWord}`;
      }
      
      const monthWord = this.getMonthWord(months);
      return `${years} ${yearWord} ${months} ${monthWord}`;
    }
  }

  private getMonthWord(months: number): string {
    if (months === 1) return 'місяць';
    if (months >= 2 && months <= 4) return 'місяці';
    return 'місяців';
  }

  private getYearWord(years: number): string {
    if (years === 1) return 'рік';
    if (years >= 2 && years <= 4) return 'роки';
    return 'років';
  }

  /**
   * Parse date string in various formats (DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD)
   */
  parseDate(dateStr: string): string | null {
    // Try DD.MM.YYYY or DD/MM/YYYY
    const euMatch = dateStr.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
    if (euMatch) {
      const [, day, month, year] = euMatch;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }

    // Try YYYY-MM-DD
    const isoMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }

    return null;
  }

  /**
   * Validate that date is reasonable (not in future, not too old)
   */
  validateBirthDate(dateStr: string): { valid: boolean; error?: string } {
    const date = new Date(dateStr);
    const now = new Date();

    if (date > now) {
      return { valid: false, error: 'Дата народження не може бути в майбутньому' };
    }

    const ageYears = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24 * 365);
    if (ageYears > 18) {
      return { valid: false, error: 'Цей бот призначений для дітей до 18 років' };
    }

    return { valid: true };
  }
}

// Singleton instance
let userServiceInstance: UserService | null = null;

export function getUserService(): UserService {
  if (!userServiceInstance) {
    userServiceInstance = new UserService();
  }
  return userServiceInstance;
}
