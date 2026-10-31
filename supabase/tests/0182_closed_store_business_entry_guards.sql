begin;
do $test$
declare a uuid:=gen_random_uuid(); shop uuid:=gen_random_uuid(); available jsonb;
begin
  insert into public.stores(id,name,short_name) values(shop,'联动验证-'||shop,'联动验证');
  insert into auth.users(id,email) values(a,a||'@linkage-qa.invalid');
  insert into public.profiles(id,store_id,username,display_name,role,employment_type) values(a,shop,'linkage-admin-'||a,'联动验证管理员','admin','full_time');
  insert into public.profile_store_access(profile_id,store_id) values(a,shop);
  insert into public.admin_store_access(admin_profile_id,store_id) values(a,shop);
  insert into public.pos_sales_integrations(store_id,provider,display_name,enabled,configured_by) values(shop,'pospal','联动验证',false,a);
  insert into public.operation_report_templates(store_id,title,fields,updated_by) values(shop,'历史报告模板','[]',a);
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.admin_set_store_operating(shop,false,'2026-10-01');
  begin
    perform public.save_payroll_store_revenue_input(shop,'2026-10-15','manual',123,'');
    raise exception 'Closed revenue RPC accepted input' using errcode='23514';
  exception when raise_exception then if strpos(sqlerrm,'关店')=0 then raise; end if;
  end;
  begin
    insert into public.payroll_store_revenue_inputs(store_id,as_of_date,input_mode,manual_cumulative_amount,updated_by) values(shop,'2026-10-15','manual',123,a);
    raise exception 'Direct closed revenue write accepted' using errcode='23514';
  exception when raise_exception then if strpos(sqlerrm,'关店')=0 then raise; end if;
  end;
  begin
    perform public.bind_qmai_sales_integration(shop,'qa','qa','qa','验证门店');
    raise exception 'Closed store binding accepted' using errcode='23514';
  exception when raise_exception then if strpos(sqlerrm,'关店')=0 then raise; end if;
  end;
  begin
    perform public.begin_operation_report_refresh(shop,'2026-10-15');
    raise exception 'Closed report refresh accepted' using errcode='23514';
  exception when raise_exception then if strpos(sqlerrm,'关店')=0 then raise; end if;
  end;
  available:=public.get_operation_report_availability(shop);
  if (available->>'available')::boolean is not true or (available->>'operating')::boolean is not false then raise exception 'Closed report availability or history changed'; end if;
  perform public.save_payroll_store_revenue_input(shop,'2026-09-30','manual',123,'关店前历史');
  if not exists(select 1 from public.payroll_store_revenue_inputs where store_id=shop and as_of_date='2026-09-30') then raise exception 'Historical maintenance blocked'; end if;
  perform public.admin_set_store_operating(shop,true,'2026-10-21');
  perform public.save_payroll_store_revenue_input(shop,'2026-10-22','manual',456,'恢复营业后');
  if not (public.get_operation_report_availability(shop)->>'operating')::boolean then raise exception 'Reopening not reflected in report'; end if;
  raise notice 'Stale/direct revenue, binding and report entry guards verified; history and reopening preserved';
end $test$;
rollback;
