"""The rules engine (``docs/specs/rules-engine.md``, ADR-0060): one plain-language rules list for every bot.

- ``store``: ``<root>/boopis/rules.json`` as the plugin reads it (the host is the only writer);
- ``data``: the owner's default rules and the engine's tables;
- ``prefilter``: what a call is, and the unedited defaults' patterns;
- ``reviewer``: the model call that judges the rest, its cache and its failures (which hold the action);
- ``gate``: the step of ``policy.check``: exceptions, the card, a scheduled run's refusal;
- ``park``: a scheduled run's refused step, kept for the owner;
- ``draft``: "Always allow" drafts the narrowest exception (``rules.draft``, writes nothing); ``rank``: the cheapest
  connected reviewer (``rules.reviewer.rank``).
"""
