-- Route all pullable non-browser stores through Bright Data Web Unlocker.
-- This ensures every data point flows through BD infrastructure, which is
-- central to the hackathon theme. Browser-required stores (needs_browser=true)
-- continue using Studio and are excluded here.
UPDATE stores
SET needs_unlocker = true
WHERE method IS NOT NULL
  AND method <> 'none'
  AND needs_browser = false;
