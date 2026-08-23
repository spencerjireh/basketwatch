-- Repair currency values that are not a three-letter code. Two populations,
-- both from Aug 23 pulls, both rejected by the read contract's length(3) pin
-- (any /products/search result set containing one fails client-side):
--
--   174 rows  'USD 11.99' style  us-kesargrocery run 100068 -- the collector
--             emitted the page's whole price label; coercePrice cleaned the
--             number, nothing cleaned the code.
--    46 rows  '₱' (peso symbol)   ph-shopsuki -- the symbol reached the column
--             uncoerced.
--
-- Symbols map to their codes; labels are guarded to rows whose first token is
-- a three-letter code. Anything else is left alone rather than guessed at.
UPDATE price_observations
SET currency = CASE trim(currency)
    WHEN '$' THEN 'USD'
    WHEN '₱' THEN 'PHP'
    WHEN '€' THEN 'EUR'
    WHEN '£' THEN 'GBP'
    ELSE upper(substring(trim(currency) from '^[A-Za-z]{3}'))
  END
WHERE length(trim(currency)) <> 3
  AND (
    trim(currency) IN ('$', '₱', '€', '£')
    OR trim(currency) ~* '^[A-Za-z]{3}([^A-Za-z]|$)'
  );
