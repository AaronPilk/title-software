begin;
do $$
declare p jsonb='{"companyEin":"","owners":[],"agreements":[{"id":"governing","title":"Combined","effectiveOn":"2026-10-06","reference":"","documentIds":["original"],"terms":[],"notes":"","kind":"combined","executed":true}],"worksheets":[],"financialTerms":{"status":"Confirmed","effectiveOn":"2026-10-06","distribution":[{"memberId":"owner-a","percentage":"60"},{"memberId":"owner-b","percentage":"40"}],"managementFeePercentage":"15","agreementMode":"single","jvAgreementId":"governing","operatingAgreementId":""}}'; b jsonb;
begin
 if not title_private.company_records_valid(p) then raise exception 'Valid separate terms rejected'; end if;
 if title_private.company_records_valid(jsonb_set(p,'{financialTerms,distribution,1,percentage}','"39.999"')) then raise exception 'Non100 distribution accepted'; end if;
 if title_private.company_records_valid(jsonb_set(p,'{financialTerms,managementFeePercentage}','"100.001"')) then raise exception 'Invalid fee accepted'; end if;
 if title_private.company_records_valid(jsonb_set(p,'{agreements,0,executed}','false')) then raise exception 'Unexecuted governing agreement accepted'; end if;
 if title_private.company_records_valid(jsonb_set(p,'{agreements,0,documentIds}','[]')) then raise exception 'Missing original accepted'; end if;
 if not title_private.company_records_valid(jsonb_set(jsonb_set(p,'{financialTerms,status}','"Draft"'),'{financialTerms,distribution,1,percentage}','""')) then raise exception 'Incomplete draft rejected'; end if;
 b='{"bankEstablished":true,"bankName":"Fictional bank","confirmation":"Established","paymentEstablished":true,"cardholder":"Fictional Title","lastFour":"1234"}';
 if not title_private.company_records_valid(p||jsonb_build_object('banking',b)) then raise exception 'Safe payment metadata rejected'; end if;
 if title_private.company_records_valid(p||jsonb_build_object('banking',b||'{"cvv":"123"}')) then raise exception 'CVV accepted'; end if;
 if title_private.company_records_valid(p||jsonb_build_object('banking',jsonb_set(b,'{lastFour}','"4111111111111111"'))) then raise exception 'PAN accepted'; end if;
 if not title_private.company_records_valid(p||'{"companyCompliance":{"status":"Delinquent","statusCheckedOn":"2026-10-06","annualReportFiledOn":"","annualReportDueOn":"2026-04-15","documentIds":["status-original"]}}') then raise exception 'Entity status rejected'; end if;
 if not exists(select 1 from jsonb_array_elements(title_private.company_record_sources(p||'{"companyCompliance":{"documentIds":["status-original"]}}')) d where d->>'id'='status-original') then raise exception 'Compliance source not bound'; end if;
end $$;
select 'Private terms SQL: independent fee/distribution, 100 percent, confirmed original requirements, incomplete draft, safe payment and compliance references passed';
rollback;
