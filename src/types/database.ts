export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      attendance_audit_logs: {
        Row: { action: 'binding_created' | 'binding_removed' | 'binding_replaced' | 'sync_requested' | 'sync_retried'; actor_id: string | null; created_at: string; entity_id: string; entity_type: 'binding' | 'sync_job'; id: string; metadata: Json; store_id: string | null };
        Insert: { action: 'binding_created' | 'binding_removed' | 'binding_replaced' | 'sync_requested' | 'sync_retried'; actor_id?: string | null; created_at?: string; entity_id: string; entity_type: 'binding' | 'sync_job'; id?: string; metadata?: Json; store_id?: string | null };
        Update: { action?: 'binding_created' | 'binding_removed' | 'binding_replaced' | 'sync_requested' | 'sync_retried'; actor_id?: string | null; created_at?: string; entity_id?: string; entity_type?: 'binding' | 'sync_job'; id?: string; metadata?: Json; store_id?: string | null };
        Relationships: [];
      };
      attendance_daily_records: {
        Row: { actual_off_at: string | null; actual_on_at: string | null; attendance_date: string; corp_id: string; created_at: string; daily_status: 'normal' | 'late' | 'early' | 'missing' | 'pending' | 'rest' | 'leave' | 'business_trip' | 'fieldwork' | 'abnormal'; data_source: 'dingtalk'; dingtalk_result_ids: string[]; early_minutes: number; enterprise_timezone: string; exception_note: string | null; id: string; is_attended: boolean; last_synced_at: string; late_minutes: number; missing_punch: 'none' | 'on' | 'off' | 'both'; off_duty_result: string; on_duty_result: string; planned_off_at: string | null; planned_on_at: string | null; profile_id: string; shift_id: string | null; shift_name: string | null; source_updated_at: string | null; store_id: string; updated_at: string };
        Insert: { actual_off_at?: string | null; actual_on_at?: string | null; attendance_date: string; corp_id: string; created_at?: string; daily_status?: 'normal' | 'late' | 'early' | 'missing' | 'pending' | 'rest' | 'leave' | 'business_trip' | 'fieldwork' | 'abnormal'; data_source?: 'dingtalk'; dingtalk_result_ids?: string[]; early_minutes?: number; enterprise_timezone?: string; exception_note?: string | null; id?: string; is_attended?: boolean; last_synced_at?: string; late_minutes?: number; missing_punch?: 'none' | 'on' | 'off' | 'both'; off_duty_result?: string; on_duty_result?: string; planned_off_at?: string | null; planned_on_at?: string | null; profile_id: string; shift_id?: string | null; shift_name?: string | null; source_updated_at?: string | null; store_id: string; updated_at?: string };
        Update: { actual_off_at?: string | null; actual_on_at?: string | null; attendance_date?: string; corp_id?: string; created_at?: string; daily_status?: 'normal' | 'late' | 'early' | 'missing' | 'pending' | 'rest' | 'leave' | 'business_trip' | 'fieldwork' | 'abnormal'; data_source?: 'dingtalk'; dingtalk_result_ids?: string[]; early_minutes?: number; enterprise_timezone?: string; exception_note?: string | null; id?: string; is_attended?: boolean; last_synced_at?: string; late_minutes?: number; missing_punch?: 'none' | 'on' | 'off' | 'both'; off_duty_result?: string; on_duty_result?: string; planned_off_at?: string | null; planned_on_at?: string | null; profile_id?: string; shift_id?: string | null; shift_name?: string | null; source_updated_at?: string | null; store_id?: string; updated_at?: string };
        Relationships: [];
      };
      attendance_punch_records: {
        Row: { check_type: 'on_duty' | 'off_duty' | 'unknown'; corp_id: string; created_at: string; daily_record_id: string; dingtalk_record_id: string; id: string; is_approved_correction: boolean; last_synced_at: string; location_name: string | null; location_result: string | null; profile_id: string; punch_time: string; source_type: string | null; store_id: string; time_result: string | null; updated_at: string };
        Insert: { check_type?: 'on_duty' | 'off_duty' | 'unknown'; corp_id: string; created_at?: string; daily_record_id: string; dingtalk_record_id: string; id?: string; is_approved_correction?: boolean; last_synced_at?: string; location_name?: string | null; location_result?: string | null; profile_id: string; punch_time: string; source_type?: string | null; store_id: string; time_result?: string | null; updated_at?: string };
        Update: { check_type?: 'on_duty' | 'off_duty' | 'unknown'; corp_id?: string; created_at?: string; daily_record_id?: string; dingtalk_record_id?: string; id?: string; is_approved_correction?: boolean; last_synced_at?: string; location_name?: string | null; location_result?: string | null; profile_id?: string; punch_time?: string; source_type?: string | null; store_id?: string; time_result?: string | null; updated_at?: string };
        Relationships: [];
      };
      attendance_sync_failures: {
        Row: { attempt_count: number; created_at: string; dingtalk_user_id: string | null; error_code: string | null; error_message: string; id: string; profile_id: string | null; resolved_at: string | null; retryable: boolean; stage: 'directory' | 'schedule' | 'result' | 'punch' | 'normalize' | 'persist'; sync_job_id: string };
        Insert: { attempt_count?: number; created_at?: string; dingtalk_user_id?: string | null; error_code?: string | null; error_message: string; id?: string; profile_id?: string | null; resolved_at?: string | null; retryable?: boolean; stage: 'directory' | 'schedule' | 'result' | 'punch' | 'normalize' | 'persist'; sync_job_id: string };
        Update: { attempt_count?: number; created_at?: string; dingtalk_user_id?: string | null; error_code?: string | null; error_message?: string; id?: string; profile_id?: string | null; resolved_at?: string | null; retryable?: boolean; stage?: 'directory' | 'schedule' | 'result' | 'punch' | 'normalize' | 'persist'; sync_job_id?: string };
        Relationships: [];
      };
      attendance_sync_jobs: {
        Row: { corp_id: string; created_at: string; error_summary: string | null; failure_count: number; finished_at: string | null; id: string; initiated_by: string | null; inserted_count: number; month_start: string | null; profile_id: string | null; progress_cursor: Json; range_end: string | null; range_start: string | null; scope_type: 'organization' | 'store' | 'employee'; skipped_count: number; started_at: string | null; status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed'; store_id: string | null; success_count: number; sync_type: 'directory' | 'current_month' | 'month' | 'date_range' | 'employee' | 'history_month'; trigger_type: 'manual' | 'scheduled' | 'retry'; updated_at: string; updated_count: number };
        Insert: { corp_id: string; created_at?: string; error_summary?: string | null; failure_count?: number; finished_at?: string | null; id?: string; initiated_by?: string | null; inserted_count?: number; month_start?: string | null; profile_id?: string | null; progress_cursor?: Json; range_end?: string | null; range_start?: string | null; scope_type: 'organization' | 'store' | 'employee'; skipped_count?: number; started_at?: string | null; status?: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed'; store_id?: string | null; success_count?: number; sync_type: 'directory' | 'current_month' | 'month' | 'date_range' | 'employee' | 'history_month'; trigger_type: 'manual' | 'scheduled' | 'retry'; updated_at?: string; updated_count?: number };
        Update: { error_summary?: string | null; failure_count?: number; finished_at?: string | null; inserted_count?: number; progress_cursor?: Json; skipped_count?: number; started_at?: string | null; status?: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed'; success_count?: number; updated_at?: string; updated_count?: number };
        Relationships: [];
      };
      dingtalk_employee_bindings: {
        Row: { binding_status: 'active' | 'inactive' | 'error'; corp_id: string; created_at: string; created_by: string | null; dingtalk_user_id: string; directory_user_id: string; error_message: string | null; id: string; last_verified_at: string | null; match_source: 'manual' | 'name_suggestion' | 'imported'; profile_id: string; store_id: string; union_id: string | null; updated_at: string };
        Insert: { binding_status?: 'active' | 'inactive' | 'error'; corp_id: string; created_at?: string; created_by?: string | null; dingtalk_user_id: string; directory_user_id: string; error_message?: string | null; id?: string; last_verified_at?: string | null; match_source?: 'manual' | 'name_suggestion' | 'imported'; profile_id: string; store_id: string; union_id?: string | null; updated_at?: string };
        Update: { binding_status?: 'active' | 'inactive' | 'error'; error_message?: string | null; last_verified_at?: string | null; match_source?: 'manual' | 'name_suggestion' | 'imported'; store_id?: string; updated_at?: string };
        Relationships: [];
      };
      dingtalk_enterprises: {
        Row: { corp_id: string; created_at: string; display_name: string; is_active: boolean; last_directory_synced_at: string | null; updated_at: string };
        Insert: { corp_id: string; created_at?: string; display_name: string; is_active?: boolean; last_directory_synced_at?: string | null; updated_at?: string };
        Update: { display_name?: string; is_active?: boolean; last_directory_synced_at?: string | null; updated_at?: string };
        Relationships: [];
      };
      dingtalk_store_enterprise_bindings: {
        Row: { corp_id: string; created_at: string; created_by: string | null; id: string; is_active: boolean; store_id: string; updated_at: string };
        Insert: { corp_id: string; created_at?: string; created_by?: string | null; id?: string; is_active?: boolean; store_id: string; updated_at?: string };
        Update: { is_active?: boolean; updated_at?: string };
        Relationships: [];
      };
      dingtalk_employee_directory: {
        Row: { corp_id: string; created_at: string; department_ids: string[]; dingtalk_user_id: string; display_name: string; id: string; is_active: boolean; job_number: string | null; last_synced_at: string; mobile_masked: string | null; union_id: string | null; updated_at: string };
        Insert: { corp_id: string; created_at?: string; department_ids?: string[]; dingtalk_user_id: string; display_name: string; id?: string; is_active?: boolean; job_number?: string | null; last_synced_at?: string; mobile_masked?: string | null; union_id?: string | null; updated_at?: string };
        Update: { department_ids?: string[]; display_name?: string; is_active?: boolean; job_number?: string | null; last_synced_at?: string; mobile_masked?: string | null; union_id?: string | null; updated_at?: string };
        Relationships: [];
      };
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
      profile_product_permissions: {
        Row: { can_request_discontinued: boolean; can_request_incorrect: boolean; can_request_new: boolean; profile_id: string; updated_at: string; updated_by: string | null; };
        Insert: { can_request_discontinued?: boolean; can_request_incorrect?: boolean; can_request_new?: boolean; profile_id: string; updated_at?: string; updated_by?: string | null; };
        Update: { can_request_discontinued?: boolean; can_request_incorrect?: boolean; can_request_new?: boolean; profile_id?: string; updated_at?: string; updated_by?: string | null; };
        Relationships: [];
      };
      v2_notices: {
        Row: { body: string; created_at: string; created_by: string; expires_at: string | null; id: string; is_pinned: boolean; published_at: string | null; requires_acknowledgment: boolean; retracted_at: string | null; status: 'draft' | 'published' | 'retracted' | 'archived'; title: string; updated_at: string; };
        Insert: { body?: string; created_at?: string; created_by: string; expires_at?: string | null; id?: string; is_pinned?: boolean; published_at?: string | null; requires_acknowledgment?: boolean; retracted_at?: string | null; status?: 'draft' | 'published' | 'retracted' | 'archived'; title: string; updated_at?: string; };
        Update: { body?: string; created_at?: string; created_by?: string; expires_at?: string | null; id?: string; is_pinned?: boolean; published_at?: string | null; requires_acknowledgment?: boolean; retracted_at?: string | null; status?: 'draft' | 'published' | 'retracted' | 'archived'; title?: string; updated_at?: string; };
        Relationships: [];
      };
      v2_notice_stores: {
        Row: { created_at: string; notice_id: string; store_id: string; };
        Insert: { created_at?: string; notice_id: string; store_id: string; };
        Update: { created_at?: string; notice_id?: string; store_id?: string; };
        Relationships: [];
      };
      v2_notice_reads: {
        Row: { notice_id: string; profile_id: string; read_at: string; };
        Insert: { notice_id: string; profile_id: string; read_at?: string; };
        Update: { notice_id?: string; profile_id?: string; read_at?: string; };
        Relationships: [];
      };
      v2_notice_recipients: {
        Row: { acknowledged_at: string | null; created_at: string; dismissed_at: string | null; first_read_at: string | null; last_read_at: string | null; notice_id: string; profile_id: string; role_snapshot: 'staff' | 'manager'; store_id: string; };
        Insert: { acknowledged_at?: string | null; created_at?: string; dismissed_at?: string | null; first_read_at?: string | null; last_read_at?: string | null; notice_id: string; profile_id: string; role_snapshot: 'staff' | 'manager'; store_id: string; };
        Update: { acknowledged_at?: string | null; created_at?: string; dismissed_at?: string | null; first_read_at?: string | null; last_read_at?: string | null; notice_id?: string; profile_id?: string; role_snapshot?: 'staff' | 'manager'; store_id?: string; };
        Relationships: [];
      };
      v2_notice_assets: {
        Row: { bucket: 'v2-notice-assets'; created_at: string; file_name: string; id: string; mime_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'; notice_id: string; object_path: string; size_bytes: number; uploaded_by: string; };
        Insert: { bucket?: 'v2-notice-assets'; created_at?: string; file_name: string; id?: string; mime_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'; notice_id: string; object_path: string; size_bytes: number; uploaded_by: string; };
        Update: { bucket?: 'v2-notice-assets'; created_at?: string; file_name?: string; id?: string; mime_type?: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'; notice_id?: string; object_path?: string; size_bytes?: number; uploaded_by?: string; };
        Relationships: [];
      };
      v2_sops: {
        Row: { body: string; category: string; created_at: string; created_by: string; effective_at: string | null; id: string; published_at: string | null; status: 'draft' | 'published' | 'archived'; task_template_id: string | null; title: string; updated_at: string; version: number; };
        Insert: { body?: string; category?: string; created_at?: string; created_by: string; effective_at?: string | null; id?: string; published_at?: string | null; status?: 'draft' | 'published' | 'archived'; task_template_id?: string | null; title: string; updated_at?: string; version?: number; };
        Update: { body?: string; category?: string; created_at?: string; created_by?: string; effective_at?: string | null; id?: string; published_at?: string | null; status?: 'draft' | 'published' | 'archived'; task_template_id?: string | null; title?: string; updated_at?: string; version?: number; };
        Relationships: [];
      };
      v2_sop_favorites: {
        Row: { created_at: string; profile_id: string; sop_id: string };
        Insert: { created_at?: string; profile_id: string; sop_id: string };
        Update: { created_at?: string; profile_id?: string; sop_id?: string };
        Relationships: [];
      };
      v2_system_documents: {
        Row: { audience: 'staff_manager' | 'admin'; content_html: string; document_version: string; slug: string; summary: string; title: string; updated_at: string; updated_by: string | null; };
        Insert: { audience: 'staff_manager' | 'admin'; content_html?: string; document_version: string; slug: string; summary?: string; title: string; updated_at?: string; updated_by?: string | null; };
        Update: { audience?: 'staff_manager' | 'admin'; content_html?: string; document_version?: string; slug?: string; summary?: string; title?: string; updated_at?: string; updated_by?: string | null; };
        Relationships: [];
      };
      v2_sop_stores: {
        Row: { created_at: string; sop_id: string; store_id: string; };
        Insert: { created_at?: string; sop_id: string; store_id: string; };
        Update: { created_at?: string; sop_id?: string; store_id?: string; };
        Relationships: [];
      };
      v2_sop_roles: {
        Row: { created_at: string; role: 'staff' | 'manager'; sop_id: string; };
        Insert: { created_at?: string; role: 'staff' | 'manager'; sop_id: string; };
        Update: { created_at?: string; role?: 'staff' | 'manager'; sop_id?: string; };
        Relationships: [];
      };
      v2_sop_categories: {
        Row: { created_at: string; created_by: string | null; id: string; is_active: boolean; name: string; sort_order: number; updated_at: string; };
        Insert: { created_at?: string; created_by?: string | null; id?: string; is_active?: boolean; name: string; sort_order?: number; updated_at?: string; };
        Update: { created_at?: string; created_by?: string | null; id?: string; is_active?: boolean; name?: string; sort_order?: number; updated_at?: string; };
        Relationships: [];
      };
      v2_sop_assets: {
        Row: { asset_kind: 'step' | 'cover' | 'attachment'; bucket: 'v2-sop-assets'; created_at: string; file_name: string | null; id: string; mime_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null; object_path: string | null; size_bytes: number; sop_id: string; sort_order: number; step_text: string; uploaded_by: string; };
        Insert: { asset_kind?: 'step' | 'cover' | 'attachment'; bucket?: 'v2-sop-assets'; created_at?: string; file_name?: string | null; id?: string; mime_type?: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null; object_path?: string | null; size_bytes?: number; sop_id: string; sort_order?: number; step_text?: string; uploaded_by: string; };
        Update: { asset_kind?: 'step' | 'cover' | 'attachment'; bucket?: 'v2-sop-assets'; created_at?: string; file_name?: string | null; id?: string; mime_type?: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null; object_path?: string | null; size_bytes?: number; sop_id?: string; sort_order?: number; step_text?: string; uploaded_by?: string; };
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
      v2_task_answers: {
        Row: { answer: Json | null; group_id: string; id: string; is_issue: boolean; item_id: string; item_snapshot: Json; last_reviewed_at: string | null; last_reviewed_by: string | null; note: string; review_status: 'pending' | 'approved' | 'rejected' | 'resubmitted'; submission_round: number; task_id: string; updated_at: string; updated_by: string | null };
        Insert: { answer?: Json | null; group_id: string; id?: string; is_issue?: boolean; item_id: string; item_snapshot: Json; last_reviewed_at?: string | null; last_reviewed_by?: string | null; note?: string; review_status?: 'pending' | 'approved' | 'rejected' | 'resubmitted'; submission_round?: number; task_id: string; updated_at?: string; updated_by?: string | null };
        Update: { answer?: Json | null; group_id?: string; id?: string; is_issue?: boolean; item_id?: string; item_snapshot?: Json; last_reviewed_at?: string | null; last_reviewed_by?: string | null; note?: string; review_status?: 'pending' | 'approved' | 'rejected' | 'resubmitted'; submission_round?: number; task_id?: string; updated_at?: string; updated_by?: string | null };
        Relationships: [];
      };
      v2_task_item_reviews: {
        Row: { actor_id: string; created_at: string; decision: 'approved' | 'rejected'; id: string; item_id: string; note: string; submission_round: number; task_id: string };
        Insert: { actor_id: string; created_at?: string; decision: 'approved' | 'rejected'; id?: string; item_id: string; note?: string; submission_round: number; task_id: string };
        Update: { actor_id?: string; created_at?: string; decision?: 'approved' | 'rejected'; id?: string; item_id?: string; note?: string; submission_round?: number; task_id?: string };
        Relationships: [];
      };
      v2_task_images: {
        Row: { bucket: string; created_at: string; file_name: string; id: string; item_id: string; mime_type: string; object_path: string; size_bytes: number; store_id: string; task_id: string; uploaded_by: string };
        Insert: { bucket?: string; created_at?: string; file_name: string; id?: string; item_id: string; mime_type: string; object_path: string; size_bytes: number; store_id: string; task_id: string; uploaded_by: string };
        Update: { bucket?: string; created_at?: string; file_name?: string; id?: string; item_id?: string; mime_type?: string; object_path?: string; size_bytes?: number; store_id?: string; task_id?: string; uploaded_by?: string };
        Relationships: [];
      };
      v2_task_reviews: {
        Row: { action: 'submitted' | 'approved' | 'rejected' | 'resubmitted'; actor_id: string; correction_item_ids: string[]; created_at: string; id: string; note: string; task_id: string };
        Insert: { action: 'submitted' | 'approved' | 'rejected' | 'resubmitted'; actor_id: string; correction_item_ids?: string[]; created_at?: string; id?: string; note?: string; task_id: string };
        Update: { action?: 'submitted' | 'approved' | 'rejected' | 'resubmitted'; actor_id?: string; correction_item_ids?: string[]; created_at?: string; id?: string; note?: string; task_id?: string };
        Relationships: [];
      };
      v2_task_schedules: {
        Row: { assigned_profile_id: string | null; created_at: string; created_by: string; due_time: string; id: string; interval_days: number | null; is_active: boolean; month_day: number | null; next_due_at: string; paused_at: string | null; paused_by: string | null; schedule_type: 'interval_days' | 'weekly' | 'monthly'; store_id: string; template_id: string; template_version_id: string; updated_at: string; weekdays: number[] };
        Insert: { assigned_profile_id?: string | null; created_at?: string; created_by: string; due_time: string; id?: string; interval_days?: number | null; is_active?: boolean; month_day?: number | null; next_due_at: string; paused_at?: string | null; paused_by?: string | null; schedule_type: 'interval_days' | 'weekly' | 'monthly'; store_id: string; template_id: string; template_version_id: string; updated_at?: string; weekdays?: number[] };
        Update: { assigned_profile_id?: string | null; created_at?: string; created_by?: string; due_time?: string; id?: string; interval_days?: number | null; is_active?: boolean; month_day?: number | null; next_due_at?: string; paused_at?: string | null; paused_by?: string | null; schedule_type?: 'interval_days' | 'weekly' | 'monthly'; store_id?: string; template_id?: string; template_version_id?: string; updated_at?: string; weekdays?: number[] };
        Relationships: [];
      };
      v2_tasks: {
        Row: { allow_overdue: boolean; assigned_profile_id: string | null; category: string; correction_item_ids: string[]; created_at: string; created_by: string; due_at: string; id: string; name: string; requires_review: boolean; review_note: string | null; reviewed_at: string | null; reviewed_by: string | null; schedule_id: string | null; snapshot: Json; started_at: string | null; started_by: string | null; status: 'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected' | 'resubmitted' | 'overdue' | 'cancelled'; store_id: string; submission_key: string | null; submitted_at: string | null; submitted_by: string | null; task_no: string; template_id: string; template_version_id: string; updated_at: string; version: number };
        Insert: { allow_overdue?: boolean; assigned_profile_id?: string | null; category: string; correction_item_ids?: string[]; created_at?: string; created_by: string; due_at: string; id?: string; name: string; requires_review?: boolean; review_note?: string | null; reviewed_at?: string | null; reviewed_by?: string | null; schedule_id?: string | null; snapshot: Json; started_at?: string | null; started_by?: string | null; status?: 'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected' | 'resubmitted' | 'overdue' | 'cancelled'; store_id: string; submission_key?: string | null; submitted_at?: string | null; submitted_by?: string | null; task_no?: string; template_id: string; template_version_id: string; updated_at?: string; version?: number };
        Update: Partial<Database['public']['Tables']['v2_tasks']['Insert']>;
        Relationships: [];
      };
      v2_task_template_groups: {
        Row: { description: string; id: string; sort_order: number; template_id: string; title: string };
        Insert: { description?: string; id?: string; sort_order?: number; template_id: string; title: string };
        Update: { description?: string; id?: string; sort_order?: number; template_id?: string; title?: string };
        Relationships: [];
      };
      v2_task_template_items: {
        Row: {
          field_type: 'instruction' | 'short_text' | 'long_text' | 'integer' | 'decimal' | 'boolean' | 'single_choice' | 'multi_choice' | 'image' | 'multi_image' | 'confirmation' | 'rating';
          group_id: string; guidance: string; id: string;
          image_requirement: 'none' | 'single' | 'multiple'; is_required: boolean;
          label: string; options: Json; reference_image_path: string | null; reference_image_paths: string[]; sort_order: number; template_id: string;
        };
        Insert: {
          field_type: 'instruction' | 'short_text' | 'long_text' | 'integer' | 'decimal' | 'boolean' | 'single_choice' | 'multi_choice' | 'image' | 'multi_image' | 'confirmation' | 'rating';
          group_id: string; guidance?: string; id?: string;
          image_requirement?: 'none' | 'single' | 'multiple'; is_required?: boolean;
          label: string; options?: Json; reference_image_path?: string | null; reference_image_paths?: string[]; sort_order?: number; template_id: string;
        };
        Update: {
          field_type?: 'instruction' | 'short_text' | 'long_text' | 'integer' | 'decimal' | 'boolean' | 'single_choice' | 'multi_choice' | 'image' | 'multi_image' | 'confirmation' | 'rating';
          group_id?: string; guidance?: string; id?: string;
          image_requirement?: 'none' | 'single' | 'multiple'; is_required?: boolean;
          label?: string; options?: Json; reference_image_path?: string | null; reference_image_paths?: string[]; sort_order?: number; template_id?: string;
        };
        Relationships: [];
      };
      v2_task_template_stores: {
        Row: { created_at: string; store_id: string; template_id: string };
        Insert: { created_at?: string; store_id: string; template_id: string };
        Update: { created_at?: string; store_id?: string; template_id?: string };
        Relationships: [];
      };
      v2_task_template_versions: {
        Row: { id: string; published_at: string; published_by: string; snapshot: Json; template_id: string; version_number: number };
        Insert: { id?: string; published_at?: string; published_by: string; snapshot: Json; template_id: string; version_number: number };
        Update: { id?: string; published_at?: string; published_by?: string; snapshot?: Json; template_id?: string; version_number?: number };
        Relationships: [];
      };
      v2_task_templates: {
        Row: {
          allow_overdue: boolean; category: 'weekly_clean' | 'monthly_clean' | 'inspection' | 'temporary';
          created_at: string; created_by: string; current_version: number; description: string;
          due_time: string | null; id: string; name: string; recurrence: 'none' | 'weekly' | 'monthly'; recurrence_day: number | null;
          requires_review: boolean; status: 'draft' | 'published' | 'archived'; updated_at: string;
        };
        Insert: {
          allow_overdue?: boolean; category: 'weekly_clean' | 'monthly_clean' | 'inspection' | 'temporary';
          created_at?: string; created_by: string; current_version?: number; description?: string;
          due_time?: string | null; id?: string; name: string; recurrence?: 'none' | 'weekly' | 'monthly'; recurrence_day?: number | null;
          requires_review?: boolean; status?: 'draft' | 'published' | 'archived'; updated_at?: string;
        };
        Update: {
          allow_overdue?: boolean; category?: 'weekly_clean' | 'monthly_clean' | 'inspection' | 'temporary';
          created_at?: string; created_by?: string; current_version?: number; description?: string;
          due_time?: string | null; id?: string; name?: string; recurrence?: 'none' | 'weekly' | 'monthly'; recurrence_day?: number | null;
          requires_review?: boolean; status?: 'draft' | 'published' | 'archived'; updated_at?: string;
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
      attendance_monthly_summary: {
        Row: { abnormal_count: number | null; attendance_dates: string[] | null; attendance_days: number | null; last_synced_at: string | null; late_count: number | null; late_minutes: number | null; missing_count: number | null; month_start: string | null; profile_id: string | null; store_id: string | null };
        Relationships: [];
      };
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
      admin_attendance_month: { Args: { p_limit?: number; p_month: string; p_offset?: number; p_search?: string; p_status?: string; p_store_id?: string | null }; Returns: Json };
      configure_attendance_automation: { Args: Record<PropertyKey, never>; Returns: Json };
      get_attendance_month_detail: { Args: { p_month: string; p_profile_id: string }; Returns: Json };
      get_v2_sop_detail: { Args: { p_sop_id: string }; Returns: Json };
      list_v2_sop_cards: { Args: { p_archived?: boolean; p_category?: string; p_favorites_only?: boolean; p_limit?: number; p_offset?: number; p_search?: string }; Returns: Json };
      attach_v2_task_template_reference_image: { Args: { p_item_id: string; p_path: string; p_template_id: string }; Returns: string[] };
      admin_set_product_permissions: { Args: { p_can_request_discontinued: boolean; p_can_request_incorrect: boolean; p_can_request_new: boolean; p_profile_id: string }; Returns: Json };
      acknowledge_v2_notice: { Args: { p_notice_id: string }; Returns: Json };
      archive_v2_notice: { Args: { p_notice_id: string }; Returns: Json };
      admin_v2_analytics: { Args: { p_days?: number; p_end_date?: string; p_start_date?: string }; Returns: Json };
      delete_v2_notice: { Args: { p_notice_id: string }; Returns: Json };
      delete_archived_v2_sop: { Args: { p_sop_id: string }; Returns: Json };
      delete_v2_sop_category: { Args: { p_category_id: string }; Returns: Json };
      delete_archived_v2_task_template: { Args: { p_template_id: string }; Returns: Json };
      archive_v2_sop: { Args: { p_sop_id: string }; Returns: Json };
      can_manage_v2_notice: { Args: { p_notice_id: string }; Returns: boolean };
      can_manage_v2_sop: { Args: { p_sop_id: string }; Returns: boolean };
      can_read_v2_notice: { Args: { p_notice_id: string }; Returns: boolean };
      can_read_v2_sop: { Args: { p_sop_id: string }; Returns: boolean };
      can_edit_v2_task: { Args: { p_task_id: string }; Returns: boolean };
      can_request_product_feedback: { Args: { p_feedback_type: string }; Returns: boolean };
      can_read_v2_task: { Args: { p_task_id: string }; Returns: boolean };
      admin_operation_overview: { Args: Record<PropertyKey, never>; Returns: { arrival_pending: number; arrival_today: number; inventory_completed_today: number; inventory_pending: number; v2_task_active: number; v2_task_completed: number }[] };
      create_v2_task_schedule: { Args: { p_first_due_at: string; p_interval_days: number | null; p_month_day: number | null; p_profile_ids: string[]; p_schedule_type: string; p_store_ids: string[]; p_template_id: string; p_weekdays: number[] }; Returns: Database['public']['Tables']['v2_tasks']['Row'][] };
      create_v2_sop_text_step: { Args: { p_sop_id: string; p_sort_order: number; p_step_text: string }; Returns: Json };
      pause_v2_task_schedule: { Args: { p_schedule_id: string }; Returns: Json };
      mark_v2_notice_read: { Args: { p_notice_id: string }; Returns: Json };
      publish_v2_notice: { Args: { p_notice_id: string }; Returns: Json };
      publish_v2_sop: { Args: { p_sop_id: string }; Returns: Json };
      publish_v2_sop_with_options: { Args: { p_silent: boolean; p_sop_id: string }; Returns: Json };
      publish_v2_tasks: { Args: { p_due_at: string | null; p_profile_ids: string[]; p_store_ids: string[]; p_template_id: string }; Returns: Database['public']['Tables']['v2_tasks']['Row'][] };
      admin_bind_dingtalk_employee: { Args: { p_directory_user_id: string; p_match_source?: string; p_profile_id: string; p_store_id?: string | null }; Returns: Json };
      admin_remove_dingtalk_store_enterprise: { Args: { p_mapping_id: string }; Returns: Json };
      admin_save_dingtalk_store_enterprise: { Args: { p_corp_id: string; p_display_name: string; p_store_id: string }; Returns: Json };
      admin_unbind_dingtalk_employee: { Args: { p_binding_id: string }; Returns: Json };
      resume_v2_task_schedule: { Args: { p_schedule_id: string }; Returns: Json };
      reorder_v2_sop_assets: { Args: { p_asset_ids: string[]; p_sop_id: string }; Returns: Json };
      rename_v2_sop_category: { Args: { p_category_id: string; p_new_name: string }; Returns: Json };
      review_v2_task: { Args: { p_action: string; p_correction_item_ids: string[]; p_note: string; p_task_id: string }; Returns: Json };
      review_v2_task_items: { Args: { p_decisions: Json; p_note: string; p_task_id: string }; Returns: Json };
      withdraw_v2_task: { Args: { p_task_id: string }; Returns: Json };
      retract_v2_notice: { Args: { p_notice_id: string }; Returns: Json };
      retract_v2_task_template: { Args: { p_template_id: string }; Returns: Json };
      retract_v2_sop: { Args: { p_sop_id: string }; Returns: Json };
      unarchive_v2_sop: { Args: { p_sop_id: string }; Returns: Json };
      save_v2_notice: { Args: { p_fields: Json; p_notice_id: string | null; p_store_ids: string[] }; Returns: Json };
      save_v2_sop: { Args: { p_fields: Json; p_roles: string[]; p_sop_id: string | null; p_store_ids: string[] }; Returns: Json };
      save_v2_task_progress: { Args: { p_answers: Json; p_expected_version: number; p_task_id: string }; Returns: Json };
      submit_v2_task: { Args: { p_expected_version: number; p_key: string; p_task_id: string }; Returns: Json };
      archive_v2_task_template: {
        Args: { p_template_id: string };
        Returns: Json;
      };
      can_manage_v2_task_template: {
        Args: { target_template_id: string };
        Returns: boolean;
      };
      can_view_v2_task_template: {
        Args: { target_template_id: string };
        Returns: boolean;
      };
      publish_v2_task_template: {
        Args: { p_template_id: string };
        Returns: Json;
      };
      save_v2_task_template: {
        Args: { p_fields: Json; p_groups: Json; p_store_ids: string[]; p_template_id: string | null };
        Returns: Json;
      };
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
