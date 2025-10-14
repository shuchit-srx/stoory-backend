-- Computes per-brand owner counts of distinct bids and campaigns they created, and counts of involved requests
-- Usage: select * from get_brand_owner_involvement_counts(ARRAY[uuid1, uuid2, ...]);

create or replace function get_brand_owner_involvement_counts(ids uuid[])
returns table (
  brand_owner_id uuid,
  created_bids_count bigint,
  created_campaigns_count bigint,
  requests_to_bids_count bigint,
  requests_to_campaigns_count bigint
)
language sql stable as $$
  -- Brand owners create bids and campaigns; requests link influencers to those
  with created_bids as (
    select created_by as brand_owner_id, count(*) as created_bids_count
    from bids
    where created_by = any(ids)
    group by created_by
  ),
  created_campaigns as (
    select created_by as brand_owner_id, count(*) as created_campaigns_count
    from campaigns
    where created_by = any(ids)
    group by created_by
  ),
  requests_to_bids as (
    select c.created_by as brand_owner_id, count(distinct r.id) as requests_to_bids_count
    from requests r
    join bids b on b.id = r.bid_id
    join users c on c.id = b.created_by
    where b.created_by = any(ids)
    group by c.created_by
  ),
  requests_to_campaigns as (
    select c.created_by as brand_owner_id, count(distinct r.id) as requests_to_campaigns_count
    from requests r
    join campaigns c on c.id = r.campaign_id
    where c.created_by = any(ids)
    group by c.created_by
  )
  select i as brand_owner_id,
         coalesce(cb.created_bids_count, 0) as created_bids_count,
         coalesce(cc.created_campaigns_count, 0) as created_campaigns_count,
         coalesce(rb.requests_to_bids_count, 0) as requests_to_bids_count,
         coalesce(rc.requests_to_campaigns_count, 0) as requests_to_campaigns_count
  from unnest(ids) as i
  left join created_bids cb on cb.brand_owner_id = i
  left join created_campaigns cc on cc.brand_owner_id = i
  left join requests_to_bids rb on rb.brand_owner_id = i
  left join requests_to_campaigns rc on rc.brand_owner_id = i
$$;

-- Optional: grant execute to anon/authenticated if needed; service role can always execute

