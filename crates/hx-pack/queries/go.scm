(function_declaration name: (identifier) @name) @definition.function
(method_declaration
  receiver: (parameter_list (parameter_declaration type: (_) @parent))
  name: (field_identifier) @name) @definition.method
(type_spec name: (type_identifier) @name type: (struct_type)) @definition.struct
(type_spec name: (type_identifier) @name type: (interface_type)) @definition.interface
(type_spec name: (type_identifier) @name type: [(type_identifier) (qualified_type) (pointer_type) (slice_type) (array_type) (map_type) (channel_type) (function_type) (generic_type)]) @definition.type
