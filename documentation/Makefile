DIR=$(notdir ${PWD})

.PHONY: all compile clean rename

all: compile rename clean

compile:
	pdflatex --shell-escape main.tex 
	bibtex main
	pdflatex --shell-escape main.tex
	pdflatex --shell-escape main.tex
clean:
	rm *.aux *.log *.out *.bbl *.blg *.toc *.lua *.brf
	rm -rf _markdown_*
rename:
	mv main.pdf ${DIR}.pdf