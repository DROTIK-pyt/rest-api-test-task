# rest-api-test-task
Тестовое задание

# Install
1) Обязательно сделайте дамп базы данных (rest_api.sql) либо создайте таблицы вручную (users, files).
2) После в файле app.js измените объект dbHandler (64 строка файла) на свои параметры.
3) Затем запустите проект и можно тестировать.
```
npm install
```

# Description
Полученные токены нужно обязательно сохранить.
accessToken - передавать в заголовках Authorization как berear token.
refreshToken - передавать в теле запроса в формате x-www-form-urlencoded (urlencoded) с ключом "refreshToken".
При загрузке/обновлении файла новый файл нужно передавать в теле запроса в формате form-data с ключом "filedata".

# UPD
Все тесты проводились в программе Postman. Дополнительной конфигурации Postman для работы с REST API не требуется.
