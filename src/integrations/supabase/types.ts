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
          cardsight_parallel_id: string | null
          created_at: string
          current_value: number | null
          grade: string | null
          grader: string | null
          id: string
          is_autograph: boolean
          is_first_bowman: boolean
          is_rookie: boolean
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
          cardsight_parallel_id?: string | null
          created_at?: string
          current_value?: number | null
          grade?: string | null
          grader?: string | null
          id?: string
          is_autograph?: boolean
          is_first_bowman?: boolean
          is_rookie?: boolean
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
          cardsight_parallel_id?: string | null
          created_at?: string
          current_value?: number | null
          grade?: string | null
          grader?: string | null
          id?: string
          is_autograph?: boolean
          is_first_bowman?: boolean
          is_rookie?: boolean
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          is_public: boolean
          share_slug: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          is_public?: boolean
          share_slug?: string | null
          updated_at?: string
        }
        Update: {
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
