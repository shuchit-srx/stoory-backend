-- Computes per-influencer counts of distinct bids and campaigns they are involved in via requests
-- Usage: select * from get_influencer_involvement_counts(ARRAY[uuid1, uuid2, ...]);

create or replace function get_influencer_involvement_counts(ids uuid[])
returns table (
  influencer_id uuid,
  bids_count bigint,
  campaigns_count bigint
)
language sql stable as $$
  with base as (
    select r.influencer_id, r.bid_id, r.campaign_id
    from requests r
    where r.influencer_id = any(ids)
  ),
  bids as (
    select influencer_id, count(distinct bid_id) as bids_count
    from base
    where bid_id is not null
    group by influencer_id
  ),
  campaigns as (
    select influencer_id, count(distinct campaign_id) as campaigns_count
    from base
    where campaign_id is not null
    group by influencer_id
  )
  select i as influencer_id,
         coalesce(b.bids_count, 0) as bids_count,
         coalesce(c.campaigns_count, 0) as campaigns_count
  from unnest(ids) as i
  left join bids b on b.influencer_id = i
  left join campaigns c on c.influencer_id = i
$$;

-- Optional: grant execute to anon/authenticated if needed; service role can always execute

