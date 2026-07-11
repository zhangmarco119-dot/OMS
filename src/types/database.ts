export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      arrival_report_images: {
        Row: {
          bucket: string;
          created_at: string;
          file_name: string;
          height: number | null;
          id: string;
          image_type: 'waybill' | 'goods';
          mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
          object_path: string;
          report_id: string;
          size_bytes: number;
          store_id: string;
          uploaded_by: string;
          width: number | null;
        };
        Insert: {
          bucket?: string;
          created_at?: string;
          file_name: string;
          height?: number | null;
          id?: string;
          image_type: 'waybill' | 'goods';
          mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
          object_path: string;
          report_id: string;
          size_bytes: number;
          store_id: string;
          uploaded_by: string;
          width?: number | null;
        };
        Update: {
          bucket?: string;
          created_at?: string;
          file_name?: string;
          height?: number | null;
          id?: string;
          image_type?: 'waybill' | 'goods';
          mime_type?: 'image/jpeg' | 'image/png' | 'image/webp';
          object_path?: string;
          report_id?: string;
          size_bytes?: number;
          store_id?: string;
          uploaded_by?: string;
          width?: number | null;
        };
        Relationships: [];
      };
      arrival_report_items: {
        Row: {
          created_at: string;
          id: string;
          is_unmatched_product: boolean;
          note: string | null;
          product_id: string | null;
          product_name_snapshot: string;
          quantity: number;
          report_id: string;
          sort_order: number;
          unit: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_unmatched_product?: boolean;
          note?: string | null;
          product_id?: string | null;
          product_name_snapshot: string;
          quantity: number;
          report_id: string;
          sort_order?: number;
          unit: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_unmatched_product?: boolean;
          note?: string | null;
          product_id?: string | null;
          product_name_snapshot?: string;
          quantity?: number;
          report_id?: string;
          sort_order?: number;
          unit?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      arrival_reports: {
        Row: {
          arrival_date: string;
          arrival_time: string | null;
          carrier_name: string | null;
          created_at: string;
          generated_summary: string;
          id: string;
          note: string | null;
          report_no: string;
          reported_by: string;
          reporter_name_snapshot: string;
          status: 'draft' | 'submitted' | 'viewed' | 'voided';
          store_id: string;
          store_name_snapshot: string;
          submission_key: string | null;
          submitted_at: string | null;
          tracking_no: string | null;
          updated_at: string;
          version: number;
          viewed_at: string | null;
          viewed_by: string | null;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        Insert: {
          arrival_date?: string;
          arrival_time?: string | null;
          carrier_name?: string | null;
          created_at?: string;
          generated_summary?: string;
          id?: string;
          note?: string | null;
          report_no?: string;
          reported_by: string;
          reporter_name_snapshot?: string;
          status?: 'draft' | 'submitted' | 'viewed' | 'voided';
          store_id: string;
          store_name_snapshot?: string;
          submission_key?: string | null;
          submitted_at?: string | null;
          tracking_no?: string | null;
          updated_at?: string;
          version?: number;
          viewed_at?: string | null;
          viewed_by?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          arrival_date?: string;
          arrival_time?: string | null;
          carrier_name?: string | null;
          created_at?: string;
          generated_summary?: string;
          id?: string;
          note?: string | null;
          report_no?: string;
          reported_by?: string;
          reporter_name_snapshot?: string;
          status?: 'draft' | 'submitted' | 'viewed' | 'voided';
          store_id?: string;
          store_name_snapshot?: string;
          submission_key?: string | null;
          submitted_at?: string | null;
          tracking_no?: string | null;
          updated_at?: string;
          version?: number;
          viewed_at?: string | null;
          viewed_by?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [];
      };
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
      notifications: {
        Row: {
          body: string;
          created_at: string;
          dedupe_key: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          is_read: boolean;
          read_at: string | null;
          recipient_role: 'staff' | 'manager' | 'admin' | null;
          recipient_user_id: string | null;
          store_id: string | null;
          title: string;
          type: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          dedupe_key?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          is_read?: boolean;
          read_at?: string | null;
          recipient_role?: 'staff' | 'manager' | 'admin' | null;
          recipient_user_id?: string | null;
          store_id?: string | null;
          title: string;
          type: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          dedupe_key?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          is_read?: boolean;
          read_at?: string | null;
          recipient_role?: 'staff' | 'manager' | 'admin' | null;
          recipient_user_id?: string | null;
          store_id?: string | null;
          title?: string;
          type?: string;
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
    Views: {
      arrival_daily_detail_view: {
        Row: {
          arrival_date: string | null;
          arrival_time: string | null;
          is_unmatched_product: boolean | null;
          item_id: string | null;
          product_id: string | null;
          product_name_snapshot: string | null;
          quantity: number | null;
          report_id: string | null;
          report_no: string | null;
          reported_by: string | null;
          reporter_name_snapshot: string | null;
          sort_order: number | null;
          status: string | null;
          store_id: string | null;
          store_name_snapshot: string | null;
          submitted_at: string | null;
          unit: string | null;
        };
        Relationships: [];
      };
      arrival_daily_product_summary_view: {
        Row: {
          arrival_date: string | null;
          product_name_snapshot: string | null;
          report_count: number | null;
          store_id: string | null;
          store_name_snapshot: string | null;
          total_quantity: number | null;
          unit: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      can_edit_arrival_report: {
        Args: { target_report_id: string };
        Returns: boolean;
      };
      can_operate_arrival_modules: {
        Args: { target_store_id: string };
        Returns: boolean;
      };
      can_read_arrival_image_object: {
        Args: { p_object_name: string };
        Returns: boolean;
      };
      can_read_arrival_report: {
        Args: { target_report_id: string };
        Returns: boolean;
      };
      can_write_arrival_image_object: {
        Args: { p_object_name: string };
        Returns: boolean;
      };
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
      generate_arrival_report_no: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      generate_arrival_summary: {
        Args: { target_report_id: string };
        Returns: string;
      };
      mark_arrival_viewed: {
        Args: { p_report_id: string };
        Returns: Json;
      };
      save_arrival_draft: {
        Args: {
          p_expected_version: number;
          p_fields: Json;
          p_items: Json;
          p_report_id: string;
        };
        Returns: Json;
      };
      submit_arrival_report: {
        Args: {
          p_expected_version: number;
          p_idempotency_key: string;
          p_report_id: string;
        };
        Returns: Json;
      };
      void_arrival_report: {
        Args: { p_reason: string; p_report_id: string };
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
