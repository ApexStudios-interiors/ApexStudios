// GENERATED FILE. Do not edit by hand — run `pnpm db:types`.
// Produced by scripts/gen-types.mjs (introspection, no Docker — see its header for why).

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type Database = {
  public: {
    Tables: {
      approvals: {
        Row: {
          id: string;
          org_id: string;
          project_id: string;
          package_id: string;
          phase_id: string | null;
          ref_no: string;
          type: Database["public"]["Enums"]["approval_type"];
          item: string;
          note: string | null;
          needed_by: string | null;
          status: Database["public"]["Enums"]["approval_status"];
          requested_by: string;
          decided_by: string | null;
          decided_at: string | null;
          decision_reason: string | null;
          supersedes_id: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          created_by: string | null;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          project_id: string;
          package_id: string;
          phase_id?: string | null;
          ref_no: string;
          type: Database["public"]["Enums"]["approval_type"];
          item: string;
          note?: string | null;
          needed_by?: string | null;
          status?: Database["public"]["Enums"]["approval_status"];
          requested_by: string;
          decided_by?: string | null;
          decided_at?: string | null;
          decision_reason?: string | null;
          supersedes_id?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          project_id?: string;
          package_id?: string;
          phase_id?: string | null;
          ref_no?: string;
          type?: Database["public"]["Enums"]["approval_type"];
          item?: string;
          note?: string | null;
          needed_by?: string | null;
          status?: Database["public"]["Enums"]["approval_status"];
          requested_by?: string;
          decided_by?: string | null;
          decided_at?: string | null;
          decision_reason?: string | null;
          supersedes_id?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      attachments: {
        Row: {
          id: string;
          org_id: string;
          project_id: string | null;
          entity_type: Database["public"]["Enums"]["attachment_entity"];
          entity_id: string;
          r2_key: string;
          thumb_r2_key: string | null;
          file_name: string;
          mime_type: string;
          size_bytes: number;
          uploaded_by: string;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          project_id?: string | null;
          entity_type: Database["public"]["Enums"]["attachment_entity"];
          entity_id: string;
          r2_key: string;
          thumb_r2_key?: string | null;
          file_name: string;
          mime_type: string;
          size_bytes: number;
          uploaded_by: string;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          project_id?: string | null;
          entity_type?: Database["public"]["Enums"]["attachment_entity"];
          entity_id?: string;
          r2_key?: string;
          thumb_r2_key?: string | null;
          file_name?: string;
          mime_type?: string;
          size_bytes?: number;
          uploaded_by?: string;
          created_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: number;
          org_id: string;
          actor_id: string | null;
          actor_role: Database["public"]["Enums"]["app_role"] | null;
          entity_type: string;
          entity_id: string | null;
          action: string;
          before: Json | null;
          after: Json | null;
          ip: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          org_id: string;
          actor_id?: string | null;
          actor_role?: Database["public"]["Enums"]["app_role"] | null;
          entity_type: string;
          entity_id?: string | null;
          action: string;
          before?: Json | null;
          after?: Json | null;
          ip?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          org_id?: string;
          actor_id?: string | null;
          actor_role?: Database["public"]["Enums"]["app_role"] | null;
          entity_type?: string;
          entity_id?: string | null;
          action?: string;
          before?: Json | null;
          after?: Json | null;
          ip?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      bill_events: {
        Row: {
          id: string;
          bill_id: string;
          from_status: Database["public"]["Enums"]["bill_status"] | null;
          to_status: Database["public"]["Enums"]["bill_status"];
          actor_id: string;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          bill_id: string;
          from_status?: Database["public"]["Enums"]["bill_status"] | null;
          to_status: Database["public"]["Enums"]["bill_status"];
          actor_id: string;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          bill_id?: string;
          from_status?: Database["public"]["Enums"]["bill_status"] | null;
          to_status?: Database["public"]["Enums"]["bill_status"];
          actor_id?: string;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      bill_lines: {
        Row: {
          id: string;
          bill_id: string;
          source_type: Database["public"]["Enums"]["bill_line_source"];
          source_id: string | null;
          description: string;
          client_value: number;
          pct_billed: number;
          amount: number;
          internal_cost: number;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          bill_id: string;
          source_type: Database["public"]["Enums"]["bill_line_source"];
          source_id?: string | null;
          description: string;
          client_value: number;
          pct_billed?: number;
          amount: number;
          internal_cost?: number;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          bill_id?: string;
          source_type?: Database["public"]["Enums"]["bill_line_source"];
          source_id?: string | null;
          description?: string;
          client_value?: number;
          pct_billed?: number;
          amount?: number;
          internal_cost?: number;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      bills: {
        Row: {
          id: string;
          org_id: string;
          project_id: string;
          seq_no: number;
          bill_no: string;
          bill_date: string;
          period_from: string | null;
          period_to: string | null;
          status: Database["public"]["Enums"]["bill_status"];
          revision: number;
          work_value: number;
          material_value: number;
          gross_amount: number;
          mas_recovery_amount: number;
          taxable_amount: number;
          gst_amount: number;
          invoice_total: number;
          retention_amount: number;
          tds_amount: number;
          advance_recovery: number;
          net_payable: number;
          gst_rate_pct: number;
          retention_pct: number;
          tds_pct: number;
          internal_cost_amount: number;
          margin_amount: number;
          notes: string | null;
          created_by: string;
          submitted_at: string | null;
          submitted_by: string | null;
          certified_at: string | null;
          certified_by: string | null;
          certification_note: string | null;
          paid_at: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          idempotency_key: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          project_id: string;
          seq_no: number;
          bill_no: string;
          bill_date?: string;
          period_from?: string | null;
          period_to?: string | null;
          status?: Database["public"]["Enums"]["bill_status"];
          revision?: number;
          work_value?: number;
          material_value?: number;
          gross_amount?: number;
          mas_recovery_amount?: number;
          taxable_amount?: number;
          gst_amount?: number;
          invoice_total?: number;
          retention_amount?: number;
          tds_amount?: number;
          advance_recovery?: number;
          net_payable?: number;
          gst_rate_pct: number;
          retention_pct: number;
          tds_pct: number;
          internal_cost_amount?: number;
          margin_amount?: number;
          notes?: string | null;
          created_by: string;
          submitted_at?: string | null;
          submitted_by?: string | null;
          certified_at?: string | null;
          certified_by?: string | null;
          certification_note?: string | null;
          paid_at?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          idempotency_key?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          project_id?: string;
          seq_no?: number;
          bill_no?: string;
          bill_date?: string;
          period_from?: string | null;
          period_to?: string | null;
          status?: Database["public"]["Enums"]["bill_status"];
          revision?: number;
          work_value?: number;
          material_value?: number;
          gross_amount?: number;
          mas_recovery_amount?: number;
          taxable_amount?: number;
          gst_amount?: number;
          invoice_total?: number;
          retention_amount?: number;
          tds_amount?: number;
          advance_recovery?: number;
          net_payable?: number;
          gst_rate_pct?: number;
          retention_pct?: number;
          tds_pct?: number;
          internal_cost_amount?: number;
          margin_amount?: number;
          notes?: string | null;
          created_by?: string;
          submitted_at?: string | null;
          submitted_by?: string | null;
          certified_at?: string | null;
          certified_by?: string | null;
          certification_note?: string | null;
          paid_at?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          idempotency_key?: string | null;
        };
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          contact_person: string | null;
          email: string | null;
          phone: string | null;
          gstin: string | null;
          billing_address: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          contact_person?: string | null;
          email?: string | null;
          phone?: string | null;
          gstin?: string | null;
          billing_address?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          contact_person?: string | null;
          email?: string | null;
          phone?: string | null;
          gstin?: string | null;
          billing_address?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      daily_updates: {
        Row: {
          id: string;
          org_id: string;
          project_id: string;
          package_id: string;
          update_date: string;
          body: string;
          author_id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          created_by: string | null;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          project_id: string;
          package_id: string;
          update_date?: string;
          body: string;
          author_id: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          project_id?: string;
          package_id?: string;
          update_date?: string;
          body?: string;
          author_id?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      inventory_items: {
        Row: {
          id: string;
          org_id: string;
          project_id: string | null;
          name: string;
          category: string | null;
          sku: string | null;
          unit: string;
          qty_on_hand: number;
          reorder_level: number;
          unit_cost: number;
          location: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          project_id?: string | null;
          name: string;
          category?: string | null;
          sku?: string | null;
          unit: string;
          qty_on_hand?: number;
          reorder_level?: number;
          unit_cost?: number;
          location?: string | null;
          created_at?: string;
          created_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          project_id?: string | null;
          name?: string;
          category?: string | null;
          sku?: string | null;
          unit?: string;
          qty_on_hand?: number;
          reorder_level?: number;
          unit_cost?: number;
          location?: string | null;
          created_at?: string;
          created_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      jobs: {
        Row: {
          id: string;
          org_id: string | null;
          name: string;
          status: Database["public"]["Enums"]["job_status"];
          payload: Json;
          idempotency_key: string | null;
          attempts: number;
          max_attempts: number;
          run_after: string;
          lease_until: string | null;
          last_error: string | null;
          started_at: string | null;
          finished_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id?: string | null;
          name: string;
          status?: Database["public"]["Enums"]["job_status"];
          payload?: Json;
          idempotency_key?: string | null;
          attempts?: number;
          max_attempts?: number;
          run_after?: string;
          lease_until?: string | null;
          last_error?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string | null;
          name?: string;
          status?: Database["public"]["Enums"]["job_status"];
          payload?: Json;
          idempotency_key?: string | null;
          attempts?: number;
          max_attempts?: number;
          run_after?: string;
          lease_until?: string | null;
          last_error?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      orgs: {
        Row: {
          id: string;
          name: string;
          legal_name: string | null;
          gstin: string | null;
          pan: string | null;
          address: string | null;
          logo_r2_key: string | null;
          created_at: string;
          bank_name: string | null;
          bank_account_no: string | null;
          bank_ifsc: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          legal_name?: string | null;
          gstin?: string | null;
          pan?: string | null;
          address?: string | null;
          logo_r2_key?: string | null;
          created_at?: string;
          bank_name?: string | null;
          bank_account_no?: string | null;
          bank_ifsc?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          legal_name?: string | null;
          gstin?: string | null;
          pan?: string | null;
          address?: string | null;
          logo_r2_key?: string | null;
          created_at?: string;
          bank_name?: string | null;
          bank_account_no?: string | null;
          bank_ifsc?: string | null;
        };
        Relationships: [];
      };
      packages: {
        Row: {
          id: string;
          org_id: string;
          project_id: string;
          seq_no: number;
          name: string;
          lead_profile_id: string | null;
          allocated_amount: number;
          internal_amount: number;
          status: Database["public"]["Enums"]["package_status"];
          progress_pct: number;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          project_id: string;
          seq_no: number;
          name: string;
          lead_profile_id?: string | null;
          allocated_amount?: number;
          internal_amount?: number;
          status?: Database["public"]["Enums"]["package_status"];
          progress_pct?: number;
          created_at?: string;
          created_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          project_id?: string;
          seq_no?: number;
          name?: string;
          lead_profile_id?: string | null;
          allocated_amount?: number;
          internal_amount?: number;
          status?: Database["public"]["Enums"]["package_status"];
          progress_pct?: number;
          created_at?: string;
          created_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          org_id: string;
          bill_id: string;
          amount: number;
          paid_on: string;
          mode: string | null;
          reference_no: string | null;
          note: string | null;
          created_by: string;
          created_at: string;
          idempotency_key: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          bill_id: string;
          amount: number;
          paid_on: string;
          mode?: string | null;
          reference_no?: string | null;
          note?: string | null;
          created_by: string;
          created_at?: string;
          idempotency_key?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          bill_id?: string;
          amount?: number;
          paid_on?: string;
          mode?: string | null;
          reference_no?: string | null;
          note?: string | null;
          created_by?: string;
          created_at?: string;
          idempotency_key?: string | null;
        };
        Relationships: [];
      };
      phases: {
        Row: {
          id: string;
          org_id: string;
          project_id: string;
          package_id: string;
          seq_no: number;
          name: string;
          allocated_amount: number;
          internal_amount: number;
          billing_status: Database["public"]["Enums"]["phase_billing_status"];
          manual_complete_at: string | null;
          manual_complete_by: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          project_id: string;
          package_id: string;
          seq_no: number;
          name: string;
          allocated_amount?: number;
          internal_amount?: number;
          billing_status?: Database["public"]["Enums"]["phase_billing_status"];
          manual_complete_at?: string | null;
          manual_complete_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          project_id?: string;
          package_id?: string;
          seq_no?: number;
          name?: string;
          allocated_amount?: number;
          internal_amount?: number;
          billing_status?: Database["public"]["Enums"]["phase_billing_status"];
          manual_complete_at?: string | null;
          manual_complete_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          org_id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          role: Database["public"]["Enums"]["app_role"];
          is_active: boolean;
          last_seen_at: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string;
          org_id: string;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          is_active?: boolean;
          last_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          full_name?: string;
          email?: string | null;
          phone?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          is_active?: boolean;
          last_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      project_members: {
        Row: {
          project_id: string;
          profile_id: string;
          added_at: string;
          added_by: string | null;
        };
        Insert: {
          project_id: string;
          profile_id: string;
          added_at?: string;
          added_by?: string | null;
        };
        Update: {
          project_id?: string;
          profile_id?: string;
          added_at?: string;
          added_by?: string | null;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          org_id: string;
          client_id: string;
          code: string;
          name: string;
          location: string | null;
          status: Database["public"]["Enums"]["project_status"];
          start_date: string;
          target_end_date: string | null;
          contract_value: number;
          gst_rate_pct: number;
          retention_pct: number;
          mas_billable_pct: number;
          tds_pct: number;
          mobilisation_advance: number;
          mobilisation_recovered: number;
          progress_pct: number;
          next_bill_seq: number;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          completed_at: string | null;
          next_sr_seq: number;
          next_ap_seq: number;
          mobilisation_recovery_pct: number;
        };
        Insert: {
          id?: string;
          org_id: string;
          client_id: string;
          code: string;
          name: string;
          location?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          start_date: string;
          target_end_date?: string | null;
          contract_value?: number;
          gst_rate_pct?: number;
          retention_pct?: number;
          mas_billable_pct?: number;
          tds_pct?: number;
          mobilisation_advance?: number;
          mobilisation_recovered?: number;
          progress_pct?: number;
          next_bill_seq?: number;
          created_at?: string;
          created_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          deleted_at?: string | null;
          completed_at?: string | null;
          next_sr_seq?: number;
          next_ap_seq?: number;
          mobilisation_recovery_pct?: number;
        };
        Update: {
          id?: string;
          org_id?: string;
          client_id?: string;
          code?: string;
          name?: string;
          location?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          start_date?: string;
          target_end_date?: string | null;
          contract_value?: number;
          gst_rate_pct?: number;
          retention_pct?: number;
          mas_billable_pct?: number;
          tds_pct?: number;
          mobilisation_advance?: number;
          mobilisation_recovered?: number;
          progress_pct?: number;
          next_bill_seq?: number;
          created_at?: string;
          created_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          deleted_at?: string | null;
          completed_at?: string | null;
          next_sr_seq?: number;
          next_ap_seq?: number;
          mobilisation_recovery_pct?: number;
        };
        Relationships: [];
      };
      rate_limits: {
        Row: {
          profile_id: string;
          action: string;
          window_start: string;
          count: number;
        };
        Insert: {
          profile_id: string;
          action: string;
          window_start?: string;
          count?: number;
        };
        Update: {
          profile_id?: string;
          action?: string;
          window_start?: string;
          count?: number;
        };
        Relationships: [];
      };
      stock_movements: {
        Row: {
          id: string;
          org_id: string;
          inventory_item_id: string;
          project_id: string | null;
          direction: Database["public"]["Enums"]["movement_direction"];
          qty: number;
          unit_cost: number;
          ref_type: string | null;
          ref_id: string | null;
          reason: string | null;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          inventory_item_id: string;
          project_id?: string | null;
          direction: Database["public"]["Enums"]["movement_direction"];
          qty: number;
          unit_cost?: number;
          ref_type?: string | null;
          ref_id?: string | null;
          reason?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          inventory_item_id?: string;
          project_id?: string | null;
          direction?: Database["public"]["Enums"]["movement_direction"];
          qty?: number;
          unit_cost?: number;
          ref_type?: string | null;
          ref_id?: string | null;
          reason?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      stock_request_events: {
        Row: {
          id: string;
          request_id: string;
          from_status: Database["public"]["Enums"]["stock_request_status"] | null;
          to_status: Database["public"]["Enums"]["stock_request_status"];
          actor_id: string;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          request_id: string;
          from_status?: Database["public"]["Enums"]["stock_request_status"] | null;
          to_status: Database["public"]["Enums"]["stock_request_status"];
          actor_id: string;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          request_id?: string;
          from_status?: Database["public"]["Enums"]["stock_request_status"] | null;
          to_status?: Database["public"]["Enums"]["stock_request_status"];
          actor_id?: string;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      stock_requests: {
        Row: {
          id: string;
          org_id: string;
          project_id: string;
          package_id: string;
          phase_id: string | null;
          ref_no: string;
          inventory_item_id: string | null;
          material_name: string;
          qty: number;
          unit: string;
          rate: number | null;
          needed_by: string | null;
          note: string | null;
          status: Database["public"]["Enums"]["stock_request_status"];
          requested_by: string;
          approved_by: string | null;
          approved_at: string | null;
          ordered_at: string | null;
          delivered_by: string | null;
          delivered_at: string | null;
          rejected_reason: string | null;
          billed_on_bill_id: string | null;
          created_at: string;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          project_id: string;
          package_id: string;
          phase_id?: string | null;
          ref_no: string;
          inventory_item_id?: string | null;
          material_name: string;
          qty: number;
          unit: string;
          rate?: number | null;
          needed_by?: string | null;
          note?: string | null;
          status?: Database["public"]["Enums"]["stock_request_status"];
          requested_by: string;
          approved_by?: string | null;
          approved_at?: string | null;
          ordered_at?: string | null;
          delivered_by?: string | null;
          delivered_at?: string | null;
          rejected_reason?: string | null;
          billed_on_bill_id?: string | null;
          created_at?: string;
          updated_at?: string;
          updated_by?: string | null;
          deleted_at?: string | null;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          project_id?: string;
          package_id?: string;
          phase_id?: string | null;
          ref_no?: string;
          inventory_item_id?: string | null;
          material_name?: string;
          qty?: number;
          unit?: string;
          rate?: number | null;
          needed_by?: string | null;
          note?: string | null;
          status?: Database["public"]["Enums"]["stock_request_status"];
          requested_by?: string;
          approved_by?: string | null;
          approved_at?: string | null;
          ordered_at?: string | null;
          delivered_by?: string | null;
          delivered_at?: string | null;
          rejected_reason?: string | null;
          billed_on_bill_id?: string | null;
          created_at?: string;
          updated_at?: string;
          updated_by?: string | null;
          deleted_at?: string | null;
          created_by?: string | null;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          org_id: string;
          project_id: string;
          package_id: string;
          phase_id: string;
          name: string;
          owner_profile_id: string | null;
          start_date: string;
          duration_weeks: number;
          end_date: string | null;
          progress_pct: number;
          note: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          project_id: string;
          package_id: string;
          phase_id: string;
          name: string;
          owner_profile_id?: string | null;
          start_date: string;
          duration_weeks?: number;
          end_date?: string | null;
          progress_pct?: number;
          note?: string | null;
          created_at?: string;
          created_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          project_id?: string;
          package_id?: string;
          phase_id?: string;
          name?: string;
          owner_profile_id?: string | null;
          start_date?: string;
          duration_weeks?: number;
          end_date?: string | null;
          progress_pct?: number;
          note?: string | null;
          created_at?: string;
          created_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      units: {
        Row: {
          code: string;
          label: string;
          sort_order: number;
        };
        Insert: {
          code: string;
          label: string;
          sort_order?: number;
        };
        Update: {
          code?: string;
          label?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      v_bill_client: {
        Row: {
          id: string | null;
          project_id: string | null;
          seq_no: number | null;
          bill_no: string | null;
          bill_date: string | null;
          period_from: string | null;
          period_to: string | null;
          status: Database["public"]["Enums"]["bill_status"] | null;
          revision: number | null;
          work_value: number | null;
          material_value: number | null;
          gross_amount: number | null;
          mas_recovery_amount: number | null;
          taxable_amount: number | null;
          gst_amount: number | null;
          invoice_total: number | null;
          retention_amount: number | null;
          tds_amount: number | null;
          advance_recovery: number | null;
          net_payable: number | null;
          gst_rate_pct: number | null;
          retention_pct: number | null;
          tds_pct: number | null;
          notes: string | null;
          submitted_at: string | null;
          certified_at: string | null;
          certified_by: string | null;
          certification_note: string | null;
          paid_at: string | null;
          created_at: string | null;
        };
        Relationships: [];
      };
      v_bill_line_client: {
        Row: {
          id: string | null;
          bill_id: string | null;
          source_type: Database["public"]["Enums"]["bill_line_source"] | null;
          description: string | null;
          client_value: number | null;
          pct_billed: number | null;
          amount: number | null;
          sort_order: number | null;
        };
        Relationships: [];
      };
      v_billable_now: {
        Row: {
          project_id: string | null;
          source_type: Database["public"]["Enums"]["bill_line_source"] | null;
          source_id: string | null;
          description: string | null;
          client_value: number | null;
          pct_billed: number | null;
          amount: number | null;
          internal_cost: number | null;
        };
        Relationships: [];
      };
      v_client_name: {
        Row: {
          id: string | null;
          name: string | null;
        };
        Relationships: [];
      };
      v_inventory_site: {
        Row: {
          id: string | null;
          project_id: string | null;
          name: string | null;
          category: string | null;
          sku: string | null;
          unit: string | null;
          qty_on_hand: number | null;
          reorder_level: number | null;
          location: string | null;
          stock_status: string | null;
        };
        Relationships: [];
      };
      v_inventory_status: {
        Row: {
          id: string | null;
          org_id: string | null;
          project_id: string | null;
          name: string | null;
          category: string | null;
          sku: string | null;
          unit: string | null;
          qty_on_hand: number | null;
          reorder_level: number | null;
          unit_cost: number | null;
          location: string | null;
          created_at: string | null;
          created_by: string | null;
          updated_at: string | null;
          updated_by: string | null;
          deleted_at: string | null;
          stock_status: string | null;
          stock_value: number | null;
        };
        Relationships: [];
      };
      v_notifications: {
        Row: {
          kind: string | null;
          entity_id: string | null;
          project_id: string | null;
          title: string | null;
          href: string | null;
          created_at: string | null;
          for_roles: unknown | null;
        };
        Relationships: [];
      };
      v_package_client: {
        Row: {
          id: string | null;
          project_id: string | null;
          seq_no: number | null;
          name: string | null;
          lead_profile_id: string | null;
          contract_value: number | null;
          status: Database["public"]["Enums"]["package_status"] | null;
          progress_pct: number | null;
        };
        Relationships: [];
      };
      v_package_rollup: {
        Row: {
          package_id: string | null;
          project_id: string | null;
          allocated_amount: number | null;
          internal_amount: number | null;
          committed: number | null;
          remaining: number | null;
          used_pct: number | null;
          progress_pct: number | null;
          is_over_budget: boolean | null;
        };
        Relationships: [];
      };
      v_package_site: {
        Row: {
          id: string | null;
          project_id: string | null;
          seq_no: number | null;
          name: string | null;
          lead_profile_id: string | null;
          status: Database["public"]["Enums"]["package_status"] | null;
          progress_pct: number | null;
          open_requests: number | null;
          phase_count: number | null;
        };
        Relationships: [];
      };
      v_phase_billing: {
        Row: {
          phase_id: string | null;
          project_id: string | null;
          package_id: string | null;
          name: string | null;
          allocated_amount: number | null;
          internal_amount: number | null;
          billing_status: Database["public"]["Enums"]["phase_billing_status"] | null;
          task_count: number | null;
          tasks_done: number | null;
          is_complete: boolean | null;
        };
        Relationships: [];
      };
      v_phase_client: {
        Row: {
          id: string | null;
          project_id: string | null;
          package_id: string | null;
          seq_no: number | null;
          name: string | null;
          contract_value: number | null;
          billing_status: Database["public"]["Enums"]["phase_billing_status"] | null;
          is_complete: boolean | null;
        };
        Relationships: [];
      };
      v_phase_site: {
        Row: {
          id: string | null;
          project_id: string | null;
          package_id: string | null;
          seq_no: number | null;
          name: string | null;
          billing_status: Database["public"]["Enums"]["phase_billing_status"] | null;
          is_complete: boolean | null;
        };
        Relationships: [];
      };
      v_stock_request_site: {
        Row: {
          id: string | null;
          project_id: string | null;
          package_id: string | null;
          phase_id: string | null;
          ref_no: string | null;
          inventory_item_id: string | null;
          material_name: string | null;
          qty: number | null;
          unit: string | null;
          needed_by: string | null;
          note: string | null;
          status: Database["public"]["Enums"]["stock_request_status"] | null;
          requested_by: string | null;
          approved_at: string | null;
          ordered_at: string | null;
          delivered_at: string | null;
          rejected_reason: string | null;
          created_at: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      auth_org: {
        Args: Record<string, never>;
        Returns: string;
      };
      auth_role: {
        Args: Record<string, never>;
        Returns: Database["public"]["Enums"]["app_role"];
      };
      custom_access_token_hook: {
        Args: {
          event: Json;
        };
        Returns: Json;
      };
      fn_audit: {
        Args: {
          p_entity_type: string;
          p_entity_id: string;
          p_action: string;
          p_before?: Json;
          p_after?: Json;
        };
        Returns: unknown;
      };
      fn_cost_to_client_factor: {
        Args: {
          p_phase_id: string;
          p_package_id: string;
        };
        Returns: number;
      };
      fn_money: {
        Args: {
          v: number;
        };
        Returns: number;
      };
      fn_recompute_progress: {
        Args: {
          p_package_id: string;
          p_project_id: string;
        };
        Returns: unknown;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      is_member_of: {
        Args: {
          p_project_id: string;
        };
        Returns: boolean;
      };
      rpc_adjust_inventory: {
        Args: {
          p_item_id: string;
          p_new_qty: number;
          p_reason: string;
        };
        Returns: unknown;
      };
      rpc_check_rate_limit: {
        Args: {
          p_action: string;
          p_max_per_window: number;
          p_window_seconds?: number;
        };
        Returns: boolean;
      };
      rpc_claim_jobs: {
        Args: {
          p_names: unknown;
          p_limit?: number;
          p_lease?: string;
        };
        Returns: unknown;
      };
      rpc_create_approval: {
        Args: {
          p_id: string;
          p_project_id: string;
          p_package_id: string;
          p_type: Database["public"]["Enums"]["approval_type"];
          p_item: string;
          p_phase_id?: string;
          p_note?: string;
          p_needed_by?: string;
          p_supersedes_id?: string;
        };
        Returns: unknown;
      };
      rpc_create_bill: {
        Args: {
          p_project_id: string;
          p_lines: Json;
          p_bill_date?: string;
          p_notes?: string;
          p_idempotency_key?: string;
        };
        Returns: unknown;
      };
      rpc_create_project: {
        Args: {
          p_name: string;
          p_client_id: string;
          p_code: string;
          p_location: string;
          p_start_date: string;
          p_package_names?: unknown;
        };
        Returns: string;
      };
      rpc_create_stock_request: {
        Args: {
          p_project_id: string;
          p_package_id: string;
          p_material_name: string;
          p_qty: number;
          p_unit: string;
          p_phase_id?: string;
          p_inventory_item_id?: string;
          p_rate?: number;
          p_needed_by?: string;
          p_note?: string;
        };
        Returns: unknown;
      };
      rpc_decide_approval: {
        Args: {
          p_approval_id: string;
          p_decision: Database["public"]["Enums"]["approval_status"];
          p_reason?: string;
        };
        Returns: unknown;
      };
      rpc_enqueue_job: {
        Args: {
          p_name: string;
          p_payload?: Json;
          p_idempotency_key?: string;
          p_run_after?: string;
        };
        Returns: string;
      };
      rpc_finish_job: {
        Args: {
          p_id: string;
          p_ok: boolean;
          p_error?: string;
        };
        Returns: unknown;
      };
      rpc_inventory_drift: {
        Args: Record<string, never>;
        Returns: { item_id: string; name: string; cached_qty: number; ledger_qty: number }[];
      };
      rpc_inventory_stats: {
        Args: {
          p_project_id?: string;
          p_search?: string;
        };
        Returns: { total_items: number; total_value: number; low_count: number; critical_count: number }[];
      };
      rpc_log_impersonation: {
        Args: {
          p_action: string;
          p_previewed_role: string;
          p_project_ref: string;
        };
        Returns: unknown;
      };
      rpc_mark_phase_complete: {
        Args: {
          p_phase_id: string;
        };
        Returns: unknown;
      };
      rpc_next_project_code: {
        Args: {
          p_base: string;
        };
        Returns: string;
      };
      rpc_record_password_reset: {
        Args: {
          p_target_id: string;
        };
        Returns: unknown;
      };
      rpc_record_payment: {
        Args: {
          p_bill_id: string;
          p_amount: number;
          p_paid_on: string;
          p_mode?: string;
          p_reference_no?: string;
          p_idempotency_key?: string;
        };
        Returns: unknown;
      };
      rpc_retry_job: {
        Args: {
          p_id: string;
        };
        Returns: unknown;
      };
      rpc_set_task_progress: {
        Args: {
          p_task_id: string;
          p_pct: number;
        };
        Returns: unknown;
      };
      rpc_transition_bill: {
        Args: {
          p_bill_id: string;
          p_to_status: Database["public"]["Enums"]["bill_status"];
          p_note?: string;
        };
        Returns: unknown;
      };
      rpc_transition_stock_request: {
        Args: {
          p_request_id: string;
          p_to_status: Database["public"]["Enums"]["stock_request_status"];
          p_note?: string;
        };
        Returns: unknown;
      };
      trg_projects_completed_at: {
        Args: Record<string, never>;
        Returns: unknown;
      };
      trg_set_updated_at: {
        Args: Record<string, never>;
        Returns: unknown;
      };
      trg_tasks_after_update: {
        Args: Record<string, never>;
        Returns: unknown;
      };
      trg_tasks_check_ancestry: {
        Args: Record<string, never>;
        Returns: unknown;
      };
    };
    Enums: {
      app_role: "owner" | "admin" | "site" | "client";
      approval_status: "pending" | "approved" | "rejected";
      approval_type: "material_sample" | "drawing" | "make_model" | "milestone" | "other";
      attachment_entity: "approval" | "daily_update" | "bill" | "stock_request" | "project";
      bill_line_source: "phase" | "material" | "manual" | "adjustment";
      bill_status: "draft" | "submitted" | "certified" | "paid" | "cancelled";
      job_status: "pending" | "running" | "succeeded" | "failed";
      movement_direction: "in" | "out" | "adjust";
      package_status: "not_started" | "design" | "in_progress" | "completed";
      phase_billing_status: "unresolved" | "billable" | "billed" | "paid";
      project_status: "planning" | "active" | "on_hold" | "completed" | "archived";
      stock_request_status: "pending" | "approved" | "ordered" | "delivered" | "rejected";
    };
  };
};
