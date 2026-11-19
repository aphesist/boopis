"""Forms: one schema-driven request to the user (docs/FORMS.md, ADR-0020).

``schema`` checks a form and its answer, ``presets`` builds the convenience forms, ``service`` keeps the open forms and
resolves them, ``tools`` is the agent's side, ``rpc`` the UI's, and ``effects`` ties a saved credential to its provider.
"""
