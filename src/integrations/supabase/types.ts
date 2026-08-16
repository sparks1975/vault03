export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_requests: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      card_sales: {
        Row: {
          card_id: string
          created_at: string
          grade: string | null
          id: string
          is_manual: boolean
          price: number
          sold_at: string
          source: string | null
          title: string | null
          url: string | null
          user_id: string
        }
        Insert: {
          card_id: string
          created_at?: string
          grade?: string | null
          id?: string
          is_manual?: boolean
          price: number
          sold_at: string
          source?: string | null
          title?: string | null
          url?: string | null
          user_id: string
        }
        Update: {
          card_id?: string
          created_at?: string
          grade?: string | null
          id?: string
          is_manual?: boolean
          price?: number
          sold_at?: string
          source?: string | null
          title?: string | null
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_sales_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      card_value_history: {
        Row: {
          card_id: string
          id: string
          recorded_at: string
          user_id: string
          value: number
        }
        Insert: {
          card_id: string
          id?: string
          recorded_at?: string
          user_id: string
          value: number
        }
        Update: {
          card_id?: string
          id?: string
          recorded_at?: string
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "card_value_history_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      cards: {
        Row: {
          card_number: string | null
          cardsight_card_id: string | null
          cardsight_grade_id: string | null
          cardsight_lookup_failed_at: string | null
          cardsight_parallel_id: string | null
          created_at: string
          current_value: number | null
          grade: string | null
          grader: string | null
          id: string
          is_autograph: boolean
          is_first_bowman: boolean
          is_rookie: boolean
          last_valuation_failed_at: string | null
          last_valued_at: string | null
          mlb_player_id: number | null
          notes: string | null
          parallel: string | null
          photo_url: string | null
          player_name: string
          position: string | null
          purchase_price: number | null
          serial_number: string | null
          set_name: string | null
          sort_order: number | null
          team: string | null
          updated_at: string
          user_id: string
          value_delta_pct: number | null
          year: number | null
        }
        Insert: {
          card_number?: string | null
          cardsight_card_id?: string | null
          cardsight_grade_id?: string | null
          cardsight_lookup_failed_at?: string | null
          cardsight_parallel_id?: string | null
          created_at?: string
          current_value?: number | null
          grade?: string | null
          grader?: string | null
          id?: string
          is_autograph?: boolean
          is_first_bowman?: boolean
          is_rookie?: boolean
          last_valuation_failed_at?: string | null
          last_valued_at?: string | null
          mlb_player_id?: number | null
          notes?: string | null
          parallel?: string | null
          photo_url?: string | null
          player_name: string
          position?: string | null
          purchase_price?: number | null
          serial_number?: string | null
          set_name?: string | null
          sort_order?: number | null
          team?: string | null
          updated_at?: string
          user_id: string
          value_delta_pct?: number | null
          year?: number | null
        }
        Update: {
          card_number?: string | null
          cardsight_card_id?: string | null
          cardsight_grade_id?: string | null
          cardsight_lookup_failed_at?: string | null
          cardsight_parallel_id?: string | null
          created_at?: string
          current_value?: number | null
          grade?: string | null
          grader?: string | null
          id?: string
          is_autograph?: boolean
          is_first_bowman?: boolean
          is_rookie?: boolean
          last_valuation_failed_at?: string | null
          last_valued_at?: string | null
          mlb_player_id?: number | null
          notes?: string | null
          parallel?: string | null
          photo_url?: string | null
          player_name?: string
          position?: string | null
          purchase_price?: number | null
          serial_number?: string | null
          set_name?: string | null
          sort_order?: number | null
          team?: string | null
          updated_at?: string
          user_id?: string
          value_delta_pct?: number | null
          year?: number | null
        }
        Relationships: []
      }
      cardsight_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          payload: Json
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at: string
          payload: Json
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          payload?: Json
        }
        Relationships: []
      }
      contest_entries: {
        Row: {
          contest_id: string
          created_at: string
          id: string
          multiplier_total: number
          score: number
          submitted_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contest_id: string
          created_at?: string
          id?: string
          multiplier_total?: number
          score?: number
          submitted_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contest_id?: string
          created_at?: string
          id?: string
          multiplier_total?: number
          score?: number
          submitted_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contest_entries_contest_id_fkey"
            columns: ["contest_id"]
            isOneToOne: false
            referencedRelation: "contests"
            referencedColumns: ["id"]
          },
        ]
      }
      contest_entry_cards: {
        Row: {
          card_id: string
          created_at: string
          entry_id: string
          id: string
          mlb_player_id: number | null
          multiplier: number
          player_points: number
          points: number
          stats: Json | null
          user_id: string
        }
        Insert: {
          card_id: string
          created_at?: string
          entry_id: string
          id?: string
          mlb_player_id?: number | null
          multiplier?: number
          player_points?: number
          points?: number
          stats?: Json | null
          user_id: string
        }
        Update: {
          card_id?: string
          created_at?: string
          entry_id?: string
          id?: string
          mlb_player_id?: number | null
          multiplier?: number
          player_points?: number
          points?: number
          stats?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contest_entry_cards_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contest_entry_cards_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "contest_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      contests: {
        Row: {
          created_at: string
          id: string
          lock_at: string
          resolved_at: string | null
          status: string
          updated_at: string
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          lock_at: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          lock_at?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      invites: {
        Row: {
          code_hash: string
          code_preview: string | null
          created_at: string
          email: string
          email_sent_at: string | null
          expires_at: string | null
          id: string
          invited_by: string | null
          status: string
          updated_at: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code_hash: string
          code_preview?: string | null
          created_at?: string
          email: string
          email_sent_at?: string | null
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          status?: string
          updated_at?: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code_hash?: string
          code_preview?: string | null
          created_at?: string
          email?: string
          email_sent_at?: string | null
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          status?: string
          updated_at?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          access_status: string
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          is_public: boolean
          share_slug: string | null
          updated_at: string
        }
        Insert: {
          access_status?: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          is_public?: boolean
          share_slug?: string | null
          updated_at?: string
        }
        Update: {
          access_status?: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_public?: boolean
          share_slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pt130_comps: {
        Row: {
          card_id: string
          id: string
          image_url: string | null
          listing_type: string | null
          price: number
          scraped_at: string
          sold_at: string | null
          title: string | null
          url: string | null
          user_id: string
        }
        Insert: {
          card_id: string
          id?: string
          image_url?: string | null
          listing_type?: string | null
          price: number
          scraped_at?: string
          sold_at?: string | null
          title?: string | null
          url?: string | null
          user_id: string
        }
        Update: {
          card_id?: string
          id?: string
          image_url?: string | null
          listing_type?: string | null
          price?: number
          scraped_at?: string
          sold_at?: string | null
          title?: string | null
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pt130_comps_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      user_badges: {
        Row: {
          awarded_at: string
          badge_type: string
          contest_id: string | null
          id: string
          user_id: string
        }
        Insert: {
          awarded_at?: string
          badge_type: string
          contest_id?: string | null
          id?: string
          user_id: string
        }
        Update: {
          awarded_at?: string
          badge_type?: string
          contest_id?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_badges_contest_id_fkey"
            columns: ["contest_id"]
            isOneToOne: false
            referencedRelation: "contests"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      redeem_invite: {
        Args: { _code_hash: string; _user_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "member"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "member"],
    },
  },
} as const
