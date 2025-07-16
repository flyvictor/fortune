FROM mongo:8.0.3

COPY *.json /
CMD mongoimport --host mongodb --db test-app --collection pets --type json --file /pets.json --jsonArray \
    && mongoimport --host mongodb --db test-app --collection users --type json --file /users.json --jsonArray \
    && mongoimport --host mongodb --db test-app --collection pet-documents --type json --file /pet-documents.json --jsonArray
