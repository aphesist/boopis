(function_declaration name: (identifier) @name) @definition.function
(generator_function_declaration name: (identifier) @name) @definition.function
(class_declaration name: (type_identifier) @name) @definition.class
(abstract_class_declaration name: (type_identifier) @name) @definition.class
(interface_declaration name: (type_identifier) @name) @definition.interface
(type_alias_declaration name: (type_identifier) @name) @definition.type
(enum_declaration name: (identifier) @name) @definition.enum
(internal_module name: (_) @name) @definition.module
(method_definition name: (_) @name) @definition.function
(abstract_method_signature name: (_) @name) @definition.function
(method_signature name: (_) @name) @definition.function
(lexical_declaration
  (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)])) @definition.function
