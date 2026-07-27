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
      calculation_settings: {
        Row: {
          advertising_percent: number
          created_at: string
          desired_profit: number
          duties_per_unit: number
          fulfillment_fee: number
          id: string
          inbound_shipping_per_unit: number
          prep_cost_per_unit: number
          referral_fee_percent: number
          return_allowance_percent: number
          storage_cost: number
          updated_at: string
          user_id: string
        }
        Insert: {
          advertising_percent?: number
          created_at?: string
          desired_profit?: number
          duties_per_unit?: number
          fulfillment_fee?: number
          id?: string
          inbound_shipping_per_unit?: number
          prep_cost_per_unit?: number
          referral_fee_percent?: number
          return_allowance_percent?: number
          storage_cost?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          advertising_percent?: number
          created_at?: string
          desired_profit?: number
          duties_per_unit?: number
          fulfillment_fee?: number
          id?: string
          inbound_shipping_per_unit?: number
          prep_cost_per_unit?: number
          referral_fee_percent?: number
          return_allowance_percent?: number
          storage_cost?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      product_scans: {
        Row: {
          analysis_status: string
          brand: string | null
          created_at: string
          guest_session_id: string | null
          id: string
          input_url: string
          normalized_url: string | null
          product_data: Json
          title: string | null
          upc_gtin: string | null
          updated_at: string
          user_id: string | null
          walmart_item_id: string | null
        }
        Insert: {
          analysis_status?: string
          brand?: string | null
          created_at?: string
          guest_session_id?: string | null
          id?: string
          input_url: string
          normalized_url?: string | null
          product_data?: Json
          title?: string | null
          upc_gtin?: string | null
          updated_at?: string
          user_id?: string | null
          walmart_item_id?: string | null
        }
        Update: {
          analysis_status?: string
          brand?: string | null
          created_at?: string
          guest_session_id?: string | null
          id?: string
          input_url?: string
          normalized_url?: string | null
          product_data?: Json
          title?: string | null
          upc_gtin?: string | null
          updated_at?: string
          user_id?: string | null
          walmart_item_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      saved_products: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          product_scan_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          product_scan_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          product_scan_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_products_product_scan_id_fkey"
            columns: ["product_scan_id"]
            isOneToOne: false
            referencedRelation: "product_scans"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_results: {
        Row: {
          authorization_status: string | null
          case_pack: number | null
          contact_data: Json
          country: string | null
          created_at: string
          currency: string | null
          estimated_landed_cost: number | null
          estimated_shipping: number | null
          id: string
          lead_time_days: number | null
          location: string | null
          moq: number | null
          private_label_available: boolean | null
          product_match: string | null
          product_scan_id: string
          sample_available: boolean | null
          source: string | null
          supplier_name: string
          supplier_type: string | null
          supplier_url: string | null
          unit_cost: number | null
          updated_at: string
          verification_status: string | null
        }
        Insert: {
          authorization_status?: string | null
          case_pack?: number | null
          contact_data?: Json
          country?: string | null
          created_at?: string
          currency?: string | null
          estimated_landed_cost?: number | null
          estimated_shipping?: number | null
          id?: string
          lead_time_days?: number | null
          location?: string | null
          moq?: number | null
          private_label_available?: boolean | null
          product_match?: string | null
          product_scan_id: string
          sample_available?: boolean | null
          source?: string | null
          supplier_name: string
          supplier_type?: string | null
          supplier_url?: string | null
          unit_cost?: number | null
          updated_at?: string
          verification_status?: string | null
        }
        Update: {
          authorization_status?: string | null
          case_pack?: number | null
          contact_data?: Json
          country?: string | null
          created_at?: string
          currency?: string | null
          estimated_landed_cost?: number | null
          estimated_shipping?: number | null
          id?: string
          lead_time_days?: number | null
          location?: string | null
          moq?: number | null
          private_label_available?: boolean | null
          product_match?: string | null
          product_scan_id?: string
          sample_available?: boolean | null
          source?: string | null
          supplier_name?: string
          supplier_type?: string | null
          supplier_url?: string | null
          unit_cost?: number | null
          updated_at?: string
          verification_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_results_product_scan_id_fkey"
            columns: ["product_scan_id"]
            isOneToOne: false
            referencedRelation: "product_scans"
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
