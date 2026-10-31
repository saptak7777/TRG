# TRG Editor (Experimental VS Code Extension)

Experimental native text editing, virtual file system, and syntax highlighting for **TRG relative grid files (`.trg`)**.

## Features

* **Native Monaco Editor Integration:** Transparent virtual file system (`trg:`) allows editing `.trg` files with standard line numbers, cursor navigation, and find/replace.
* **Transparent Save:** Automatically decodes on read and compiles to the 8-byte master header + 1-byte relative cell payload on save.
* **Multilingual Syntax Highlighting:** Script-neutral support for SINC keywords (`fn`, `loop`, `ret`, `[`, `]`), ASCII operators, and regional phonetic scripts (Bengali, Devanagari/Hindi, Tamil, etc.).
* **Container Inspection:** Right-click any `.trg` file and select "TRG: Inspect Container Descriptor" to view character count, declared script anchor, and flags.
