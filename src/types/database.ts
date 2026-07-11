export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      admin_store_access: {
        Row: {
          admin_profile_id: string;
          created_at: string;
          store_id: string;
        };
        Insert: {
          admin_profile_id: string;
          created_at?: string;
          store_id: string;
        };
        Update: {
          admin_profile_id?: string;
          created_at?: string;
          store_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'admin_store_access_admin_profile_id_fkey';
            columns: ['admin_profile_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'admin_store_access_store_id_fkey';
            columns: ['store_id'];
            referencedRelation: 'stores';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_table: string;
          id: string;
          metadata: Json;
          store_id: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_table: string;
          id?: string;
          metadata?: Json;
          store_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_table?: string;
          id?: string;
          metadata?: Json;
          store_id?: string | null;
        };
        Relationships: [];
      };
      admin_task_reads: {
        Row: {
          admin_profile_id: string;
          read_at: string;
          task_id: string;
        };
        Insert: {
          admin_profile_id: string;
          read_at?: string;
          task_id: string;
        };
        Update: {
          admin_profile_id?: string;
          read_at?: string;
          task_id?: string;
        };
        Relationships: [];
      };
      product_feedback: {
        Row: {
          created_at: string;
          created_by: string;
          feedback_type: 'discontinued' | 'incorrect' | 'new';
          handled_at: string | null;
          handled_by: string | null;
          id: string;
          note: string | null;
          original_snapshot: Json;
          product_id: string | null;
          resolution_note: string | null;
          status: 'open' | 'resolved' | 'ignored' | 'reverted';
          store_id: string;
          suggested_changes: Json;
          task_item_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          feedback_type: 'discontinued' | 'incorrect' | 'new';
          handled_at?: string | null;
          handled_by?: string | null;
          id?: string;
          note?: string | null;
          original_snapshot: Json;
          product_id?: string | null;
          resolution_note?: string | null;
          status?: 'open' | 'resolved' | 'ignored' | 'reverted';
          store_id: string;
          suggested_changes?: Json;
          task_item_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          feedback_type?: 'discontinued' | 'incorrect' | 'new';
          handled_at?: string | null;
          handled_by?: string | null;
          id?: string;
          note?: string | null;
          original_snapshot?: Json;
          product_id?: string | null;
          resolution_note?: string | null;
          status?: 'open' | 'resolved' | 'ignored' | 'reverted';
          store_id?: string;
          suggested_changes?: Json;
          task_item_id?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          count_unit: string;
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          product_code: string | null;
          sort_order: number;
          spec: string;
          store_id: string;
          updated_at: string;
        };
        Insert: {
          count_unit: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          product_code?: string | null;
          sort_order?: number;
          spec: string;
          store_id: string;
          updated_at?: string;
        };
        Update: {
          count_unit?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          product_code?: string | null;
          sort_order?: number;
          spec?: string;
          store_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          display_name: string;
          id: string;
          is_active: boolean;
          role: 'staff' | 'manager' | 'admin';
          store_id: string;
          updated_at: string;
          username: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          display_name: string;
          id: string;
          is_active?: boolean;
          role: 'staff' | 'manager' | 'admin';
          store_id: string;
          updated_at?: string;
          username: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          display_name?: string;
          id?: string;
          is_active?: boolean;
          role?: 'staff' | 'manager' | 'admin';
          store_id?: string;
          updated_at?: string;
          username?: string;
        };
        Relationships: [];
      };
      profile_store_access: {
        Row: {
          created_at: string;
          profile_id: string;
          store_id: string;
        };
        Insert: {
          created_at?: string;
          profile_id: string;
          store_id: string;
        };
        Update: {
          created_at?: string;
          profile_id?: string;
          store_id?: string;
        };
        Relationships: [];
      };
      stores: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          short_name: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          short_name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          short_name?: string;
        };
        Relationships: [];
      };
      task_items: {
        Row: {
          created_at: string;
          id: string;
          is_extra_item: boolean;
          product_action_status: 'deletion_requested' | 'deletion_approved' | 'deletion_ignored' | null;
          product_id: string | null;
          product_snapshot: Json;
          quantity: number | null;
          sort_order: number;
          staff_note: string | null;
          status: 'pending' | 'completed' | 'no_order_needed';
          store_id: string;
          task_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_extra_item?: boolean;
          product_action_status?: 'deletion_requested' | 'deletion_approved' | 'deletion_ignored' | null;
          product_id?: string | null;
          product_snapshot: Json;
          quantity?: number | null;
          sort_order?: number;
          staff_note?: string | null;
          status?: 'pending' | 'completed' | 'no_order_needed';
          store_id: string;
          task_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_extra_item?: boolean;
          product_action_status?: 'deletion_requested' | 'deletion_approved' | 'deletion_ignored' | null;
          product_id?: string | null;
          product_snapshot?: Json;
          quantity?: number | null;
          sort_order?: number;
          staff_note?: string | null;
          status?: 'pending' | 'completed' | 'no_order_needed';
          store_id?: string;
          task_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          created_at: string;
          created_by: string;
          export_meta: Json;
          id: string;
          started_at: string;
          status: 'draft' | 'review' | 'submitted' | 'cancelled';
          store_id: string;
          submitted_at: string | null;
          task_type: 'inventory' | 'order';
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          export_meta?: Json;
          id?: string;
          started_at?: string;
          status?: 'draft' | 'review' | 'submitted' | 'cancelled';
          store_id: string;
          submitted_at?: string | null;
          task_type: 'inventory' | 'order';
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          export_meta?: Json;
          id?: string;
          started_at?: string;
          status?: 'draft' | 'review' | 'submitted' | 'cancelled';
          store_id?: string;
          submitted_at?: string | null;
          task_type?: 'inventory' | 'order';
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      can_manage_store: {
        Args: { target_store_id: string };
        Returns: boolean;
      };
      admin_set_profile_stores: {
        Args: { p_profile_id: string; p_store_ids: string[] };
        Returns: undefined;
      };
      can_modify_task: {
        Args: { target_task_id: string };
        Returns: boolean;
      };
      can_view_task: {
        Args: { target_task_id: string };
        Returns: boolean;
      };
      current_user_role: {
        Args: Record<PropertyKey, never>;
        Returns: 'staff' | 'manager' | 'admin' | null;
      };
      switch_current_store: {
        Args: { p_store_id: string };
        Returns: string;
      };
      current_user_store_id: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      has_store_access: {
        Args: { target_store_id: string };
        Returns: boolean;
      };
      manager_update_product_from_task: {
        Args: {
          p_task_item_id: string;
          p_name: string;
          p_spec: string;
          p_count_unit: string;
          p_product_code?: string | null;
          p_note?: string | null;
        };
        Returns: Json;
      };
      manager_request_product_deletion: {
        Args: {
          p_task_item_id: string;
          p_note?: string | null;
        };
        Returns: string;
      };
      manager_add_product_from_task: {
        Args: {
          p_task_id: string;
          p_name: string;
          p_spec: string;
          p_count_unit: string;
          p_quantity: number;
          p_product_code?: string | null;
          p_note?: string | null;
        };
        Returns: Json;
      };
      list_store_inventory_templates: {
        Args: { p_limit?: number };
        Returns: Array<{
          task_id: string;
          submitted_at: string | null;
          created_by: string;
          created_by_name: string;
          total_count: number;
          processed_count: number;
          pending_count: number;
        }>;
      };
      import_inventory_task: {
        Args: {
          p_target_task_id: string;
          p_source_task_id: string;
        };
        Returns: Json;
      };
      admin_handle_product_feedback: {
        Args: {
          p_feedback_id: string;
          p_action: string;
          p_resolution_note?: string | null;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
